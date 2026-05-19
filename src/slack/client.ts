import { WebClient } from '@slack/web-api';

let slackClient: WebClient | null = null;

export function getSlackClient(): WebClient {
  if (!slackClient) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error('SLACK_BOT_TOKEN is not set');
    }
    slackClient = new WebClient(token);
  }
  return slackClient;
}

export function setSlackClient(client: WebClient): void {
  slackClient = client;
}

export function resetSlackClient(): void {
  slackClient = null;
}
