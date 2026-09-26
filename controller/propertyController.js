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

// POST /properties  (protected, provider only)
// body: { title, description, price, additionalCharges[], photos[], address,
//         latitude, longitude }
async function createProperty(req, res) {
  try {
    const provider = await getProviderProfile(req.user._id);
    if (!provider) {
      return res.status(404).json({ message: 'Provider profile not found' });
    }

    const {
      title, description, price, additionalCharges, photos,
      address, latitude, longitude,
    } = req.body;

    if (!title || !price || !address || latitude == null || longitude == null) {
      return res.status(400).json({
        message: 'title, price, address, latitude and longitude are required',
      });
    }

    const property = await Property.create({
      providerId: provider._id,
      title,
      description,
      price,
      additionalCharges: additionalCharges || [],
      photos: photos || [],
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
// query: minPrice, maxPrice, schoolId, maxDistanceKm, q, sort, page, limit
// Only ever returns verified + available listings — pending/rejected/unavailable
// properties never show up in public search, regardless of filters passed.
async function getProperties(req, res) {
  try {
    const {
      minPrice, maxPrice, schoolId, maxDistanceKm, q, sort, page = 1, limit = 20,
    } = req.query;

    const filter = {
      verificationStatus: 'verified',
      availabilityStatus: 'available',
    };

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    // Keyword search against title + description
    if (q) {
      filter.$text = { $search: q };
    }

    // Geo search: properties within maxDistanceKm of the selected school
    if (schoolId) {
      const school = await School.findById(schoolId);
      if (!school) {
        return res.status(404).json({ message: 'School not found' });
      }
      filter.location = {
        $near: {
          $geometry: school.location,
          $maxDistance: (Number(maxDistanceKm) || 10) * 1000, // km -> meters
        },
      };
    }

    let query = Property.find(filter);

    // $near (schoolId search) already returns nearest-first and can't be
    // combined with an explicit sort — so `sort` only applies when there's
    // no location filter active.
    if (!schoolId) {
      if (sort === 'price_asc') {
        query = query.sort({ price: 1 });
      } else if (sort === 'price_desc') {
        query = query.sort({ price: -1 });
      } else if (sort === 'newest') {
        query = query.sort({ createdAt: -1 });
      } else if (q) {
        // No explicit sort with a keyword search — rank by text match relevance
        query = query.select({ score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' } });
      }
    }

    const properties = await query
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    return res.json({ properties, page: Number(page), limit: Number(limit) });
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

// GET /properties/:id  (public)
// Only exposes verified listings to the public, UNLESS the requester is the
// owning provider (so a provider can preview their own pending listing).
// Populates the provider's verification status, and — if ?schoolId= is
// passed — computes the distance from that school in km.
async function getPropertyById(req, res) {
  try {
    const property = await Property.findById(req.params.id).populate(
      'providerId',
      'businessName phone verificationStatus'
    );
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    if (property.verificationStatus !== 'verified') {
      const provider = req.user ? await getProviderProfile(req.user._id) : null;
      const isOwner = provider && provider._id.equals(property.providerId._id);
      if (!isOwner) {
        return res.status(404).json({ message: 'Property not found' });
      }
    }

    let distanceKm = null;
    const { schoolId } = req.query;
    if (schoolId) {
      const school = await School.findById(schoolId);
      if (school) {
        const [propLng, propLat] = property.location.coordinates;
        const [schoolLng, schoolLat] = school.location.coordinates;
        distanceKm = Number(haversineKm(propLat, propLng, schoolLat, schoolLng).toFixed(2));
      }
    }

    return res.json({ property, distanceKm });
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
      title, description, price, additionalCharges, photos,
      address, latitude, longitude, availabilityStatus,
    } = req.body;

    if (title !== undefined) property.title = title;
    if (description !== undefined) property.description = description;
    if (price !== undefined) property.price = price;
    if (additionalCharges !== undefined) property.additionalCharges = additionalCharges;
    if (photos !== undefined) property.photos = photos;
    if (address !== undefined) property.address = address;
    if (availabilityStatus !== undefined) property.availabilityStatus = availabilityStatus;
    if (latitude != null && longitude != null) {
      property.location = { type: 'Point', coordinates: [longitude, latitude] };
    }

    // Any edit to a verified listing sends it back to pending — re-review required.
    if (property.verificationStatus === 'verified') {
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