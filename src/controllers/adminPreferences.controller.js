const Preferences = require('../services/adminPreferences.service');
exports.get = async (req, res, next) => {
  try {
    if (Object.keys(req.query).length) return res.status(400).json({ message: 'Preferences accept no query parameters.' });
    res.json({ payload: await Preferences.getPreferences(req) });
  } catch (error) { next(error); }
};
exports.save = async (req, res, next) => {
  try {
    if (Object.keys(req.query).length) return res.status(400).json({ message: 'Preferences accept no query parameters.' });
    res.json({ payload: await Preferences.savePreferences(req, req.body) });
  } catch (error) { next(error); }
};
