/** Tool definitions for Anthropic Messages API (Claude 3.5). */
export const AGENT_TOOLS = [
  {
    name: 'get_me',
    description: 'Load the signed-in user profile (name, username, email, bio, verification).',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[]
    }
  },
  {
    name: 'list_my_channels',
    description: 'List channels this user owns or is a member of (id, name, member count).',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[]
    }
  },
  {
    name: 'join_channel',
    description:
      'Join a channel by Mongo id so the user becomes a member. Only runs after explicit user approval in the app.',
    input_schema: {
      type: 'object' as const,
      properties: {
        channelId: { type: 'string', description: 'Channel document id' }
      },
      required: ['channelId']
    }
  }
];

export const TOOLS_REQUIRING_CONFIRMATION = new Set(['join_channel']);

export const AGENT_SYSTEM_PROMPT = [
  'You are Connectify AI, an in-app assistant for a social and messaging product.',
  'Use tools when they help answer accurately. Prefer get_me and list_my_channels before suggesting actions.',
  'For joining channels, always call the corresponding tool so the user can confirm in the UI.',
  'Keep assistant replies concise and friendly. If a tool returns JSON, summarize key points for the user.'
].join('\n');
