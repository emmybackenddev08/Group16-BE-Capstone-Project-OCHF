const mongoose = require('mongoose');
const { Property, ProviderProfile, StudentProfile, School } = require('../model/collectionsModel');

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

const AVAILABILITY_STATUSES = ['available', 'unavailable', 'booked']; // keep in sync with the model enum

// Turns ["wifi","water"] or "wifi, water" into a clean string array.
// Returns undefined when not supplied, null when the value is invalid.
function normalizeAmenities(input) {
  if (input === undefined) return undefined;
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : null;
  if (!list || list.some((a) => typeof a !== 'string')) return null;
  return list.map((a) => a.trim()).filter(Boolean);
}

// Distance + estimated driving time from a school to a [lng, lat] pair.
function schoolMetrics(school, lng, lat) {
  const [sLng, sLat] = school.location.coordinates;
  const distanceKm = Number(haversineKm(lat, lng, sLat, sLng).toFixed(2));
  return { distanceFromSchoolKm: distanceKm, drivingTimeMinutes: estimateDrivingMinutes(distanceKm) };
}

const validCoords = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

const PROPERTY_TYPES = ['room', 'self_contain', 'shared', 'apartment', 'hostel']; // keep in sync with the model enum

// POST /properties  (protected, provider only)
// US-14 mandatory: title (property name), address (location), schoolId, price
// (monthly rent), latitude, longitude. Distance from school and estimated
// driving time are computed server-side and stored. availabilityStatus is
// optional (defaults to 'available'). Amenities/charges/photos are optional.
// body: { title, description, price, schoolId, additionalCharges[], photos[],
//         amenities[], address, latitude, longitude, propertyType, availabilityStatus }
async function createProperty(req, res) {
  try {
    const provider = await getProviderProfile(req.user._id);
    if (!provider) {
      return res.status(404).json({ message: 'Provider profile not found' });
    }

    const {
      title, description, price, additionalCharges, photos, amenities,
      address, latitude, longitude, propertyType, schoolId, availabilityStatus,
    } = req.body;

    if (!title || price == null || price === '' || !address || latitude == null || longitude == null || !schoolId) {
      return res.status(400).json({
        message: 'title, price, address, schoolId, latitude and longitude are required',
      });
    }

    const rent = Number(price);
    if (!Number.isFinite(rent) || rent <= 0) {
      return res.status(400).json({ message: 'price must be a positive number' });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!validCoords(lat, lng)) {
      return res.status(400).json({ message: 'latitude/longitude are invalid' });
    }

    if (propertyType !== undefined && !PROPERTY_TYPES.includes(propertyType)) {
      return res.status(400).json({ message: `propertyType must be one of: ${PROPERTY_TYPES.join(', ')}` });
    }

    if (availabilityStatus !== undefined && !['available', 'unavailable'].includes(availabilityStatus)) {
      return res.status(400).json({ message: 'availabilityStatus must be available or unavailable' });
    }

    const cleanAmenities = normalizeAmenities(amenities);
    if (cleanAmenities === null) {
      return res.status(400).json({ message: 'amenities must be an array of strings' });
    }

    if (!mongoose.isValidObjectId(schoolId)) {
      return res.status(400).json({ message: 'Invalid schoolId' });
    }
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }

    const property = await Property.create({
      providerId: provider._id,
      title,
      propertyType,
      description,
      price: rent,
      additionalCharges: additionalCharges || [],
      photos: photos || [],
      amenities: cleanAmenities || [],
      address,
      location: { type: 'Point', coordinates: [lng, lat] },
      schoolId: school._id,
      ...schoolMetrics(school, lng, lat),
      ...(availabilityStatus ? { availabilityStatus } : {}),
      // verificationStatus defaults to 'pending' — goes to the admin queue (US-17)
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
// Provider name and phone are intentionally NOT populated here — provider
// details are protected (US-11/US-12) and only appear on the detail page for
// verified students. The phone is never sent to students at all.
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
      .select('title propertyType price address location photos amenities availabilityStatus verificationStatus createdAt providerId schoolId distanceFromSchoolKm drivingTimeMinutes')
      .populate('providerId', 'verificationStatus');

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
// Public info (name, rent, address, availability, verification status,
// description, photos, amenities, distance) is visible to everyone.
// PROTECTED info (US-11 / US-12):
//   - landlord/business name: verified students, the owning provider, admins
//   - landlord phone: owning provider and admins ONLY — never students/guests
// Non-verified listings are only visible to their owner and admins.
// ?schoolId= overrides the stored distance/driving time with one measured
// from that school.
async function getPropertyById(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Property not found' });
    }

    const property = await Property.findById(req.params.id).populate(
      'providerId',
      'businessName phone verificationStatus userId'
    );
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    const provider = property.providerId; // populated doc, or null if orphaned
    const isAdmin = req.user?.role === 'admin';
    const isOwner = !!(req.user && provider?.userId && provider.userId.equals(req.user._id));

    if (property.verificationStatus !== 'verified' && !isOwner && !isAdmin) {
      return res.status(404).json({ message: 'Property not found' });
    }

    let studentVerified = false;
    if (req.user?.role === 'student') {
      const sp = await StudentProfile.findOne({ userId: req.user._id }).select('verificationStatus');
      studentVerified = sp?.verificationStatus === 'verified';
    }

    const canSeeProvider = isOwner || isAdmin || studentVerified;
    const canSeePhone = isOwner || isAdmin; // never students or guests

    let lockReason = null;
    if (!canSeeProvider) {
      if (!req.user) lockReason = 'login_required';
      else if (req.user.role === 'student') lockReason = 'verification_required';
      else lockReason = 'not_permitted';
    }

    const out = property.toObject();
    out.photos = [...(out.photos || [])].sort((a, b) => a.order - b.order);
    if (provider) {
      out.providerId = { _id: provider._id, verificationStatus: provider.verificationStatus };
      if (canSeeProvider) out.providerId.businessName = provider.businessName;
      if (canSeePhone) out.providerId.phone = provider.phone;
    }

    let distanceKm = out.distanceFromSchoolKm ?? null;
    let drivingTimeMinutes = out.drivingTimeMinutes ?? null;
    const { schoolId } = req.query;
    if (schoolId && mongoose.isValidObjectId(schoolId)) {
      const school = await School.findById(schoolId);
      if (school) {
        const [propLng, propLat] = property.location.coordinates;
        const m = schoolMetrics(school, propLng, propLat);
        distanceKm = m.distanceFromSchoolKm;
        drivingTimeMinutes = m.drivingTimeMinutes;
      }
    }

    return res.json({
      property: out,
      distanceKm,
      drivingTimeMinutes,
      protectedInfo: { unlocked: canSeeProvider, reason: lockReason },
    });
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
      address, latitude, longitude, availabilityStatus, propertyType, schoolId,
    } = req.body;

    if (propertyType !== undefined && !PROPERTY_TYPES.includes(propertyType)) {
      return res.status(400).json({ message: `propertyType must be one of: ${PROPERTY_TYPES.join(', ')}` });
    }
    if (availabilityStatus !== undefined && !AVAILABILITY_STATUSES.includes(availabilityStatus)) {
      return res.status(400).json({ message: `availabilityStatus must be one of: ${AVAILABILITY_STATUSES.join(', ')}` });
    }
    if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) <= 0)) {
      return res.status(400).json({ message: 'price must be a positive number' });
    }
    const cleanAmenities = normalizeAmenities(amenities);
    if (cleanAmenities === null) {
      return res.status(400).json({ message: 'amenities must be an array of strings' });
    }

    const coordsChanged = latitude != null && longitude != null;
    if (coordsChanged && !validCoords(Number(latitude), Number(longitude))) {
      return res.status(400).json({ message: 'latitude/longitude are invalid' });
    }

    // Resolve the school (new one if provided, else the stored one) so distance
    // and driving time stay correct when the school or coordinates change.
    let school = null;
    if (schoolId !== undefined) {
      if (!mongoose.isValidObjectId(schoolId)) return res.status(400).json({ message: 'Invalid schoolId' });
      school = await School.findById(schoolId);
      if (!school) return res.status(404).json({ message: 'School not found' });
      property.schoolId = school._id;
    } else if (coordsChanged && property.schoolId) {
      school = await School.findById(property.schoolId);
    }

    if (title !== undefined) property.title = title;
    if (propertyType !== undefined) property.propertyType = propertyType;
    if (description !== undefined) property.description = description;
    if (price !== undefined) property.price = Number(price);
    if (additionalCharges !== undefined) property.additionalCharges = additionalCharges;
    if (photos !== undefined) property.photos = photos;
    if (cleanAmenities !== undefined) property.amenities = cleanAmenities;
    if (address !== undefined) property.address = address;
    if (availabilityStatus !== undefined) property.availabilityStatus = availabilityStatus;
    if (coordsChanged) {
      property.location = { type: 'Point', coordinates: [Number(longitude), Number(latitude)] };
    }
    if (school) {
      const [lng, lat] = property.location.coordinates;
      Object.assign(property, schoolMetrics(school, lng, lat));
    }

    // Edits to listing details send a verified OR rejected listing back to
    // pending for (re-)review. Changing only availability (e.g. marking it
    // booked) does not.
    const detailsChanged = [
      title, description, price, additionalCharges, photos, amenities, address,
      latitude, longitude, propertyType, schoolId,
    ].some((v) => v !== undefined);
    if (detailsChanged && ['verified', 'rejected'].includes(property.verificationStatus)) {
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