import {
	IHookFunctions,
	IWebhookFunctions,
} from 'n8n-core';

import {
	IDataObject,
	INodeTypeDescription,
	INodeType,
	IWebhookResponseData,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';

import {
	keapApiRequest,
} from './GenericFunctions';

import {
	titleCase,
 } from 'change-case';

export class KeapTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Keap Trigger',
		name: 'keapTrigger',
		icon: 'file:keap.png',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["eventId"]}}',
		description: 'Starts the workflow when Infusionsoft events occure.',
		defaults: {
			name: 'Keap Trigger',
			color: '#79af53',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'keapOAuth2Api',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'eventId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getEvents',
				},
				default: '',
				required: true,
			},
			{
				displayName: 'RAW Data',
				name: 'rawData',
				type: 'boolean',
				default: false,
				description: `Returns the data exactly in the way it got received from the API.`,
			},
		],
	};

	methods = {
		loadOptions: {
			// Get all the event types to display them to user so that he can
			// select them easily
			async getEvents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const returnData: INodePropertyOptions[] = [];
				const hooks = await keapApiRequest.call(this, 'GET', '/hooks/event_keys');
				for (const hook of hooks) {
					const hookName = hook;
					const hookId = hook;
					returnData.push({
						name: titleCase((hookName as string).replace('.', ' ')),
						value: hookId as string,
					});
				}
				return returnData;
			},
		},
	};

	// @ts-ignore (because of request)
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const eventId = this.getNodeParameter('eventId') as string;
				const webhookUrl = this.getNodeWebhookUrl('default');
				const webhookData = this.getWorkflowStaticData('node');

				const responseData = await keapApiRequest.call(this, 'GET', '/hooks', {});

				for (const existingData of responseData) {
					if (existingData.hookUrl === webhookUrl
					&&	existingData.eventKey === eventId
					&&	existingData.status === 'Verified') {
						// The webhook exists already
						webhookData.webhookId = existingData.key;
						return true;
					}
				}

				return false;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const eventId = this.getNodeParameter('eventId') as string;
				const webhookData = this.getWorkflowStaticData('node');
				const webhookUrl = this.getNodeWebhookUrl('default');

				const body = {
					eventKey: eventId,
					hookUrl: webhookUrl,
				};

				const responseData = await keapApiRequest.call(this, 'POST', '/hooks', body);

				if (responseData.key === undefined) {
					// Required data is missing so was not successful
					return false;
				}

				webhookData.webhookId = responseData.key as string;

				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');

				if (webhookData.webhookId !== undefined) {

					try {
						await keapApiRequest.call(this, 'DELETE', `/hooks/${webhookData.webhookId}`);
					} catch (e) {
						return false;
					}

					// Remove from the static workflow data so that it is clear
					// that no webhooks are registred anymore
					delete webhookData.webhookId;
				}

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const rawData = this.getNodeParameter('rawData') as boolean;
		const headers = this.getHeaderData() as IDataObject;
		const bodyData = this.getBodyData() as IDataObject;

		if (headers['x-hook-secret']) {
			// Is a create webhook confirmation request
			const res = this.getResponseObject();
			res.set('x-hook-secret', headers['x-hook-secret'] as string);
			res.status(200).end();
			return {
				noWebhookResponse: true,
			};
		}

		if (rawData) {
			return {
				workflowData: [
					this.helpers.returnJsonArray(bodyData),
				],
			};
		}

		const responseData: IDataObject[] = [];
		for (const data of bodyData.object_keys as IDataObject[]) {
			responseData.push({
				eventKey: bodyData.event_key,
				objectType: bodyData.object_type,
				id: data.id,
				timestamp: data.timestamp,
				apiUrl: data.apiUrl,
			});
		}
		return {
			workflowData: [
				this.helpers.returnJsonArray(responseData),
			],
		};
	}
}