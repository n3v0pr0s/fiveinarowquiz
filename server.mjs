import { createGameServer } from './server/http.mjs';
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const server = createGameServer();
server.listen(port, host, () => console.log(`QuizRow: http://${host}:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.rooms.shutdown();server.close();server.closeAllConnections();
});
