const mongoose = require('mongoose');
const { School } = require('../model/collectionsModel');

const validCoords = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// GET /schools (public)
// Optional query: ?q=unilag (keyword match on school name)
async function getSchools(req, res) {
  try {
    const { q } = req.query;
    const filter = {};

    if (q && q.trim()) {
      filter.name = { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    const schools = await School.find(filter).sort({ name: 1 });
    return res.json({ schools, count: schools.length });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch schools', error: err.message });
  }
}

// GET /schools/:id (public)
async function getSchoolById(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid school ID' });
    }

    const school = await School.findById(req.params.id);
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }

    return res.json({ school });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch school', error: err.message });
  }
}

// POST /schools (admin only)
// body: { name, latitude, longitude } OR { name, location: { coordinates: [lng, lat] } }
async function createSchool(req, res) {
  try {
    const { name, latitude, longitude, location } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'School name is required' });
    }

    let lat = latitude != null ? Number(latitude) : null;
    let lng = longitude != null ? Number(longitude) : null;

    if ((lat == null || lng == null) && location && Array.isArray(location.coordinates)) {
      lng = Number(location.coordinates[0]);
      lat = Number(location.coordinates[1]);
    }

    if (!validCoords(lat, lng)) {
      return res.status(400).json({
        message: 'Valid latitude (-90 to 90) and longitude (-180 to 180) are required',
      });
    }

    const existing = await School.findOne({ name: name.trim() });
    if (existing) {
      return res.status(409).json({ message: 'A school with this name already exists' });
    }

    const school = await School.create({
      name: name.trim(),
      location: {
        type: 'Point',
        coordinates: [lng, lat],
      },
    });

    return res.status(201).json({ school });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create school', error: err.message });
  }
}

module.exports = {
  getSchools,
  getSchoolById,
  createSchool,
};
