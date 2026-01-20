import { PocketServer } from '@pocket/server';

const server = new PocketServer({
  port: 3001,
  conflictStrategy: 'last-write-wins',
});

server.start().then(() => {
  console.log('Pocket sync server running on port 3001');
});
