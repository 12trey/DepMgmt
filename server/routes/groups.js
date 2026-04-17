const express = require('express');
const controller = require('../controllers/groupController');

const router = express.Router();

router.post('/verify-group', controller.verifyGroup);
router.post('/members', controller.getMembers);       // POST so credentials stay in body
router.post('/verify-user', controller.verifyUser);
router.post('/add-user', controller.addUser);
router.post('/remove-user', controller.removeUser);

module.exports = router;
