const Notifications = require('../services/adminNotifications.service');
function noQuery(req, res) { if (Object.keys(req.query).length) { res.status(400).json({ message: 'Notification endpoints accept no query parameters.' }); return false; } return true; }
exports.getRule = async (req, res, next) => { try { if (!noQuery(req, res)) return; res.json({ payload: await Notifications.getRule() }); } catch (error) { next(error); } };
exports.saveRule = async (req, res, next) => { try { if (!noQuery(req, res)) return; res.json({ payload: await Notifications.saveRule(req, req.body) }); } catch (error) { next(error); } };
exports.getPreferences = async (req, res, next) => { try { if (!noQuery(req, res)) return; res.json({ payload: await Notifications.getPreferences(req) }); } catch (error) { next(error); } };
exports.savePreferences = async (req, res, next) => { try { if (!noQuery(req, res)) return; res.json({ payload: await Notifications.savePreferences(req, req.body) }); } catch (error) { next(error); } };
exports.listDeliveries = async (req, res, next) => { try { const allowed = new Set(['limit', 'offset']); if (Object.keys(req.query).some((key) => !allowed.has(key))) return res.status(400).json({ message: 'Unsupported notification history query.' }); res.json({ payload: await Notifications.listDeliveries(req.query) }); } catch (error) { next(error); } };
