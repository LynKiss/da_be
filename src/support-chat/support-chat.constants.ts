export const SUPPORT_CHAT_NAMESPACE = '/support-chat';
export const SUPPORT_CHAT_STAFF_ROOM = 'support:staff';

export function supportChatUserRoom(userId: string) {
  return `support:user:${userId}`;
}

export function supportChatConversationRoom(conversationId: string) {
  return `support:conversation:${conversationId}`;
}
