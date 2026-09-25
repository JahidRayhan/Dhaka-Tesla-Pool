const { Router } = require('express');
const zoneController = require('../controllers/zoneController');

const router = Router();

router.get('/', zoneController.listAll);

module.exports = router;
