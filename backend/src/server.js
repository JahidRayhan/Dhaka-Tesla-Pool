require('dotenv').config();
const { assertEnv } = require('./config/validateEnv');

assertEnv(); // exit before binding a port if the config is unusable

const { bootstrap } = require('./bootstrap');
const app = require('./app');
const logger = require('./utils/logger');
const { startJobs } = require('./jobs');

const port = process.env.PORT || 4000;

bootstrap()
  .then(() => {
    app.listen(port, () => {
      logger.info('API listening', { port });
      startJobs();
    });
  })
  .catch((err) => {
    // A failed migration must stop the deploy, not leave an API running against
    // a schema it does not match.
    logger.error('Startup failed', { err });
    process.exit(1);
  });
