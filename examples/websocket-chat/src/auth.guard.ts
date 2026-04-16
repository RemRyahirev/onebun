import { createGuard, type WsExecutionContext } from '@onebun/core';

export const ChatAuthGuard = createGuard((context: WsExecutionContext) => {
  const client = context.getClient();

  // Check if client has authenticated
  if (!client.auth?.authenticated) {
    return false;
  }

  return true;
});
