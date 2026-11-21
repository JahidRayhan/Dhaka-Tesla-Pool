const { Router } = require('express');
const featureControllers = require('../controllers/featureControllers');
const zoneController = require('../controllers/zoneController');

const router = Router();

router.get('/', zoneController.listAll);

router.get('/:id/meeting-points', featureControllers.meetingPoints);

module.exports = router;
