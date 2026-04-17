const groupService = require('../services/groupService');

// Extract optional AD credential from request body
function getCredential(body) {
  const { adUsername, adPassword } = body || {};
  if (!adUsername) return null;
  return { username: adUsername, password: adPassword || '' };
}

exports.verifyGroup = async (req, res) => {
  const { name, type } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  try {
    const result = await groupService.verifyGroup(name, type, getCredential(req.body));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMembers = async (req, res) => {
  const { name, type } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  try {
    const members = await groupService.getGroupMembers(name, type, getCredential(req.body));
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.verifyUser = async (req, res) => {
  const { username, type } = req.body;
  if (!username || !type) return res.status(400).json({ error: 'username and type are required' });
  try {
    const result = await groupService.verifyUser(username, type, getCredential(req.body));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addUser = async (req, res) => {
  const { username, groupName, type } = req.body;
  if (!username || !groupName || !type) {
    return res.status(400).json({ error: 'username, groupName, and type are required' });
  }
  try {
    const result = await groupService.addUserToGroup(username, groupName, type, getCredential(req.body));
    if (!result.success) return res.status(500).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.removeUser = async (req, res) => {
  const { username, groupName, type } = req.body;
  if (!username || !groupName || !type) {
    return res.status(400).json({ error: 'username, groupName, and type are required' });
  }
  const credential = getCredential(req.body);
  try {
    const membership = await groupService.checkMembership(username, groupName, type, credential);
    if (membership.error) return res.status(500).json({ error: membership.error });
    if (!membership.isMember) {
      return res.status(400).json({ error: `"${username}" is not a member of "${groupName}"` });
    }
    const result = await groupService.removeUserFromGroup(username, groupName, type, credential);
    if (!result.success) return res.status(500).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
