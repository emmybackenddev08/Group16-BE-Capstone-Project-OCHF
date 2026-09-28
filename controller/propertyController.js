const mongoose = require('mongoose');
const { Property, ProviderProfile, School } = require('../model/collectionsModel');

// Helper: fetch the ProviderProfile for the logged-in user
async function getProviderProfile(userId) {
  return ProviderProfile.findOne({ userId });
}

// Straight-line distance in km between two lat/lng points. Used to show a
// single property's distance from a chosen school on its detail page —
// $near (used in getProperties) already handles this for search/sort, but
// a single-document lookup doesn't go through a query, so it's computed here.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ---- US-02 helpers -------------------------------------------------------
const AVG_SPEED_KMH = 25; // assumed average driving speed (MVP estimate)
const ROAD_FACTOR = 1.3;  // straight-line km -> approx road km
const EARTH_RADIUS_KM = 6378.1;

const estimateDrivingMinutes = (km) =>
  Math.ceil(((km * ROAD_FACTOR) / AVG_SPEED_KMH) * 60);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// --------------------------------------------------------------------------

const PROPERTY_TYPES = ['room', 'self_contain', 'shared', 'apartment', 'hostel']; // keep in sync with the model enum

// POST /properties  (protected, provider only)
// body: { title, description, price, additionalCharges[], photos[], amenities[],
//         address, latitude, longitude }
async function createProperty(req, res) {
  try {
    const provider = await getProviderProfile(req.user._id);
    if (!provider) {
      return res.status(404).json({ message: 'Provider profile not found' });
    }

    const {
      title, description, price, additionalCharges, photos, amenities,
      address, latitude, longitude, propertyType,
    } = req.body;

    if (propertyType !== undefined && !PROPERTY_TYPES.includes(propertyType)) {
      return res.status(400).json({ message: `propertyType must be one of: ${PROPERTY_TYPES.join(', ')}` });
    }

    if (!title || !price || !address || latitude == null || longitude == null) {
      return res.status(400).json({
        message: 'title, price, address, latitude and longitude are required',
      });
    }

    const property = await Property.create({
      providerId: provider._id,
      title,
      propertyType,
      description,
      price,
      additionalCharges: additionalCharges || [],
      photos: photos || [],
      amenities: amenities || [],
      address,
      location: { type: 'Point', coordinates: [longitude, latitude] },
      // availabilityStatus and verificationStatus default from the schema
    });

    return res.status(201).json({ property });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create property', error: err.message });
  }
}

// GET /properties  (public — student browse/search)
// query: minPrice, maxPrice, location, propertyType, amenities, availability,
//        schoolId, maxDistanceKm, q, sort, page, limit (filters combine with AND)
// Only ever returns verified + available listings — pending/rejected/unavailable
// properties never show up in public search, regardless of filters passed.
// With ?schoolId= each card also gets distanceKm + drivingTimeMinutes.
// Provider phone is intentionally NOT populated here (contact details are
// only shown on the detail page to logged-in users).
async function getProperties(req, res) {
  try {
    const { minPrice, maxPrice, schoolId, maxDistanceKm, q, sort, amenities, location, propertyType, availability } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    const filter = {
      verificationStatus: 'verified',
      availabilityStatus: 'available',
    };

    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.price = {};
      if (minPrice !== undefined) {
        if (Number.isNaN(Number(minPrice))) return res.status(400).json({ message: 'minPrice must be a number' });
        filter.price.$gte = Number(minPrice);
      }
      if (maxPrice !== undefined) {
        if (Number.isNaN(Number(maxPrice))) return res.status(400).json({ message: 'maxPrice must be a number' });
        filter.price.$lte = Number(maxPrice);
      }
    }

    // Keyword search: regex (not $text) because $text can't be combined with $near
    if (q && q.trim()) {
      const rx = new RegExp(escapeRegex(q.trim()), 'i');
      filter.$or = [{ title: rx }, { description: rx }, { address: rx }];
    }

    // Amenities filter (US-01): ?amenities=wifi,water — every listed amenity must match
    if (typeof amenities === 'string' && amenities.trim()) {
      const list = amenities.split(',').map((a) => a.trim()).filter(Boolean);
      if (list.length) filter.$and = list.map((a) => ({ amenities: new RegExp(escapeRegex(a), 'i') }));
    }

    // Location filter (US-04): text match on the address, e.g. ?location=Yaba
    if (typeof location === 'string' && location.trim()) {
      filter.address = new RegExp(escapeRegex(location.trim()), 'i');
    }

    // Property type filter (US-04)
    if (propertyType !== undefined) {
      if (typeof propertyType !== 'string' || !PROPERTY_TYPES.includes(propertyType)) {
        return res.status(400).json({ message: `propertyType must be one of: ${PROPERTY_TYPES.join(', ')}` });
      }
      filter.propertyType = propertyType;
    }

    // Availability filter (US-04) — defaults to 'available'; 'unavailable' listings are never public
    if (availability !== undefined) {
      if (!['available', 'booked'].includes(availability)) {
        return res.status(400).json({ message: 'availability must be available or booked' });
      }
      filter.availabilityStatus = availability;
    }

    // Geo search: properties within maxDistanceKm of the selected school
    let school = null;
    const countFilter = { ...filter };
    if (schoolId) {
      if (!mongoose.isValidObjectId(schoolId)) return res.status(400).json({ message: 'Invalid schoolId' });
      school = await School.findById(schoolId);
      if (!school) {
        return res.status(404).json({ message: 'School not found' });
      }

      const radiusKm = Number(maxDistanceKm) || 10;
      filter.location = {
        $near: { $geometry: school.location, $maxDistance: radiusKm * 1000 }, // km -> meters
      };
      // countDocuments() doesn't support $near, so count with $geoWithin
      countFilter.location = {
        $geoWithin: { $centerSphere: [school.location.coordinates, radiusKm / EARTH_RADIUS_KM] },
      };
    }

    let query = Property.find(filter)
      .select('title propertyType price address location photos amenities availabilityStatus verificationStatus createdAt providerId')
      .populate('providerId', 'businessName verificationStatus');

    // $near already returns nearest-first and can't be combined with an
    // explicit sort — so `sort` only applies when there's no school filter.
    if (!school) {
      const sortMap = { price_asc: { price: 1 }, price_desc: { price: -1 }, newest: { createdAt: -1 } };
      query = query.sort(sortMap[sort] || { createdAt: -1 });
    }

    const [properties, total] = await Promise.all([
      query.skip((page - 1) * limit).limit(limit).lean(),
      Property.countDocuments(countFilter),
    ]);

    const cards = properties.map((p) => {
      const { photos = [], ...rest } = p;
      const card = {
        ...rest,
        coverPhoto: [...photos].sort((a, b) => a.order - b.order)[0]?.url || null,
      };
      if (school) {
        const [pLng, pLat] = p.location.coordinates;
        const [sLng, sLat] = school.location.coordinates;
        card.distanceKm = Number(haversineKm(pLat, pLng, sLat, sLng).toFixed(2));
        card.drivingTimeMinutes = estimateDrivingMinutes(card.distanceKm);
      }
      return card;
    });

    return res.json({ properties: cards, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ message: 'Search failed', error: err.message });
  }
}

// GET /properties/mine  (protected, provider only — all statuses, own listings)
async function getMyProperties(req, res) {
  try {
    const provider = await getProviderProfile(req.user._id);
    if (!provider) {
      return res.status(404).json({ message: 'Provider profile not found' });
    }
    const properties = await Property.find({ providerId: provider._id });
    return res.json({ properties });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch listings', error: err.message });
  }
}

// GET /properties/:id  (public, with optional auth)
// Only exposes verified listings to the public, UNLESS the requester is the
// owning provider (so a provider can preview their own pending listing).
// Populates the provider's verification status, and — if ?schoolId= is
// passed — computes the distance (km) and estimated driving time from that school.
// The provider's phone number is only included when the requester is logged in
// (req.user is set by an optional-auth middleware on this route).
async function getPropertyById(req, res) {
  try {
    // Guests don't get the provider's phone number
    const providerFields = req.user
      ? 'businessName phone verificationStatus'
      : 'businessName verificationStatus';

    const property = await Property.findById(req.params.id).populate(
      'providerId',
      providerFields
    );
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    if (property.verificationStatus !== 'verified') {
      const provider = req.user ? await getProviderProfile(req.user._id) : null;
      const isOwner = provider && provider._id.equals(property.providerId?._id);
      if (!isOwner) {
        return res.status(404).json({ message: 'Property not found' });
      }
    }

    let distanceKm = null;
    let drivingTimeMinutes = null;
    const { schoolId } = req.query;
    if (schoolId && mongoose.isValidObjectId(schoolId)) {
      const school = await School.findById(schoolId);
      if (school) {
        const [propLng, propLat] = property.location.coordinates;
        const [schoolLng, schoolLat] = school.location.coordinates;
        distanceKm = Number(haversineKm(propLat, propLng, schoolLat, schoolLng).toFixed(2));
        drivingTimeMinutes = estimateDrivingMinutes(distanceKm);
      }
    }

    return res.json({ property, distanceKm, drivingTimeMinutes });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch property', error: err.message });
  }
}

// PUT /properties/:id  (protected, provider only, owner only)
async function updateProperty(req, res) {
  try {
    const provider = await getProviderProfile(req.user._id);
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }
    if (!provider || !provider._id.equals(property.providerId)) {
      return res.status(403).json({ message: 'You do not own this property' });
    }

    const {
      title, description, price, additionalCharges, photos, amenities,
      address, latitude, longitude, availabilityStatus, propertyType,
    } = req.body;

    if (propertyType !== undefined && !PROPERTY_TYPES.includes(propertyType)) {
      return res.status(400).json({ message: `propertyType must be one of: ${PROPERTY_TYPES.join(', ')}` });
    }

    if (title !== undefined) property.title = title;
    if (propertyType !== undefined) property.propertyType = propertyType;
    if (description !== undefined) property.description = description;
    if (price !== undefined) property.price = price;
    if (additionalCharges !== undefined) property.additionalCharges = additionalCharges;
    if (photos !== undefined) property.photos = photos;
    if (amenities !== undefined) property.amenities = amenities;
    if (address !== undefined) property.address = address;
    if (availabilityStatus !== undefined) property.availabilityStatus = availabilityStatus;
    if (latitude != null && longitude != null) {
      property.location = { type: 'Point', coordinates: [longitude, latitude] };
    }

    // Edits to listing details send a verified listing back to pending for
    // re-review. Changing only availability (e.g. marking it booked) does not.
    const detailsChanged = [
      title, description, price, additionalCharges, photos, amenities, address, latitude, longitude, propertyType,
    ].some((v) => v !== undefined);
    if (detailsChanged && property.verificationStatus === 'verified') {
      property.verificationStatus = 'pending';
    }

    await property.save();
    return res.json({ property });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update property', error: err.message });
  }
}

// DELETE /properties/:id  (protected, provider only, owner only)
async function deleteProperty(req, res) {
  try {
    const provider = await getProviderProfile(req.user._id);
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }
    if (!provider || !provider._id.equals(property.providerId)) {
      return res.status(403).json({ message: 'You do not own this property' });
    }

    await property.deleteOne();
    return res.json({ message: 'Property deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to delete property', error: err.message });
  }
}

module.exports = {
  createProperty,
  getProperties,
  getMyProperties,
  getPropertyById,
  updateProperty,
  deleteProperty,
};