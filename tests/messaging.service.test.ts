import { expect, mock, test } from 'bun:test';
import { CustomerConversationType, CustomerMessageAudience } from '@store/database';
import { MessagingService } from '../apps/api/src/messaging/messaging.service';

test('admin inbox queries ignore broadcast delivery records', async () => {
  let findFilter: unknown;
  let countFilter: unknown;
  let aggregatePipeline: unknown[] = [];
  const messages = {
    find: mock((filter: unknown) => { findFilter = filter; return emptyFindChain(); }),
    countDocuments: mock(async (filter: unknown) => { countFilter = filter; return 0; }),
    aggregate: mock(async (pipeline: unknown[]) => { aggregatePipeline = pipeline; return []; }),
  };
  const users = { collection: { name: 'users' }, find: mock(() => ({ select: () => ({ lean: async () => [] }) })) };
  const service = new MessagingService(users as never, messages as never, {} as never, {} as never,
    {} as never, {} as never);

  await service.list({ page: 1, limit: 20 });
  await service.listConversations({ page: 1, limit: 20 });

  const directOnly = { conversationType: CustomerConversationType.DIRECT,
    audience: { $ne: CustomerMessageAudience.BROADCAST } };
  expect(findFilter).toEqual(directOnly);
  expect(countFilter).toEqual(directOnly);
  expect(aggregatePipeline[0]).toEqual({ $match: directOnly });
});

function emptyFindChain() {
  return { sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) };
}
