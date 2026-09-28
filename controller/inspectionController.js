const { Inspection, Property, StudentProfile, ProviderProfile, Transaction } = require('../model/collectionsModel');

async function getStudentProfile(userId) {
  return StudentProfile.findOne({ userId });
}
async function getProviderProfile(userId) {
  return ProviderProfile.findOne({ userId });
}

// POST /inspections  (student only)  body: { propertyId }
// Property must be verified + available — mirrors the journey's
// "check verification status" step before a request can be made.
async function requestInspection(req, res) {
  try {
    const student = await getStudentProfile(req.user._id);
    if (!student) return res.status(404).json({ message: 'Student profile not found' });
    // US-11: only verified students can act on protected listing info
    if (student.verificationStatus !== 'verified') {
      return res.status(403).json({
        message: 'Student verification required',
        verificationStatus: student.verificationStatus,
      });
    }

    const { propertyId } = req.body;
    if (!propertyId) return res.status(400).json({ message: 'propertyId is required' });

    const property = await Property.findById(propertyId);
    if (!property) return res.status(404).json({ message: 'Property not found' });
    if (property.verificationStatus !== 'verified') {
      return res.status(400).json({ message: 'Property is not verified yet' });
    }
    if (property.availabilityStatus !== 'available') {
      return res.status(400).json({ message: 'Property is not available' });
    }

    // Block duplicate open requests for the same property by the same student
    const existing = await Inspection.findOne({
      propertyId,
      studentId: student._id,
      status: { $in: ['requested', 'confirmed', 'rescheduled'] }, // 'scheduled' is not a valid status in the model
    });
    if (existing) {
      return res.status(409).json({ message: 'You already have an open request for this property' });
    }

    const inspection = await Inspection.create({ propertyId, studentId: student._id });
    return res.status(201).json({ inspection });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to request inspection', error: err.message });
  }
}

// GET /inspections/mine  (student — all inspections they've requested)
async function getMyInspections(req, res) {
  try {
    const student = await getStudentProfile(req.user._id);
    if (!student) return res.status(404).json({ message: 'Student profile not found' });

    const inspections = await Inspection.find({ studentId: student._id }).populate('propertyId');
    return res.json({ inspections });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch inspections', error: err.message });
  }
}

// GET /inspections/received  (provider — requests on properties they own)
async function getReceivedInspections(req, res) {
  try {
    const provider = await getProviderProfile(req.user._id);
    if (!provider) return res.status(404).json({ message: 'Provider profile not found' });

    const properties = await Property.find({ providerId: provider._id }).select('_id');
    const propertyIds = properties.map((p) => p._id);

    const inspections = await Inspection.find({ propertyId: { $in: propertyIds } })
      .populate('propertyId')
      .populate('studentId');
    return res.json({ inspections });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch inspections', error: err.message });
  }
}

// GET /inspections/:id  (either the requesting student or the owning provider)
async function getInspectionById(req, res) {
  try {
    const inspection = await Inspection.findById(req.params.id)
      .populate('propertyId')
      .populate('studentId');
    if (!inspection) return res.status(404).json({ message: 'Inspection not found' });

    const student = await getStudentProfile(req.user._id);
    const provider = await getProviderProfile(req.user._id);
    const isStudent = student && student._id.equals(inspection.studentId._id);
    const isOwnerProvider =
      provider && inspection.propertyId && provider._id.equals(inspection.propertyId.providerId);

    if (!isStudent && !isOwnerProvider) {
      return res.status(403).json({ message: 'Not authorized to view this inspection' });
    }
    return res.json({ inspection });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch inspection', error: err.message });
  }
}

// PUT /inspections/:id/schedule  (provider, owner only)  body: { scheduledAt }
// First time a date is set — moves 'requested' -> 'confirmed'.
async function scheduleInspection(req, res) {
  try {
    const inspection = await Inspection.findById(req.params.id).populate('propertyId');
    if (!inspection) return res.status(404).json({ message: 'Inspection not found' });

    const provider = await getProviderProfile(req.user._id);
    if (!provider || !provider._id.equals(inspection.propertyId.providerId)) {
      return res.status(403).json({ message: 'You do not own this property' });
    }
    if (inspection.status !== 'requested') {
      return res.status(400).json({ message: `Cannot schedule an inspection with status "${inspection.status}"` });
    }

    const { scheduledAt } = req.body;
    if (!scheduledAt) return res.status(400).json({ message: 'scheduledAt is required' });

    inspection.scheduledAt = scheduledAt;
    inspection.status = 'confirmed';
    await inspection.save();
    return res.json({ inspection });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to schedule inspection', error: err.message });
  }
}

// PUT /inspections/:id/decline  (provider, owner only)  body: { reason? }
// Provider actively rejects the request outright — distinct from a student
// cancelling later, and only possible before any date has been confirmed.
async function declineInspection(req, res) {
  try {
    const inspection = await Inspection.findById(req.params.id).populate('propertyId');
    if (!inspection) return res.status(404).json({ message: 'Inspection not found' });

    const provider = await getProviderProfile(req.user._id);
    if (!provider || !provider._id.equals(inspection.propertyId.providerId)) {
      return res.status(403).json({ message: 'You do not own this property' });
    }
    if (inspection.status !== 'requested') {
      return res.status(400).json({ message: `Cannot decline an inspection with status "${inspection.status}"` });
    }

    inspection.status = 'cancelled';
    if (req.body.reason) inspection.declineReason = req.body.reason;
    await inspection.save();
    return res.json({ inspection });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to decline inspection', error: err.message });
  }
}

// PUT /inspections/:id/reschedule  (provider, owner only)  body: { scheduledAt }
// Changes the date on an already-confirmed (or previously rescheduled) inspection.
async function rescheduleInspection(req, res) {
  try {
    const inspection = await Inspection.findById(req.params.id).populate('propertyId');
    if (!inspection) return res.status(404).json({ message: 'Inspection not found' });

    const provider = await getProviderProfile(req.user._id);
    if (!provider || !provider._id.equals(inspection.propertyId.providerId)) {
      return res.status(403).json({ message: 'You do not own this property' });
    }
    if (!['confirmed', 'rescheduled'].includes(inspection.status)) {
      return res.status(400).json({
        message: `Cannot reschedule an inspection with status "${inspection.status}"`,
      });
    }

    const { scheduledAt } = req.body;
    if (!scheduledAt) return res.status(400).json({ message: 'scheduledAt is required' });

    inspection.scheduledAt = scheduledAt;
    inspection.status = 'rescheduled';
    await inspection.save();
    return res.json({ inspection });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to reschedule inspection', error: err.message });
  }
}

// PUT /inspections/:id/missed  (provider, owner only)
// Neither party attended (or the student never showed) on the scheduled date.
async function missedInspection(req, res) {
  try {
    const inspection = await Inspection.findById(req.params.id).populate('propertyId');
    if (!inspection) return res.status(404).json({ message: 'Inspection not found' });

    const provider = await getProviderProfile(req.user._id);
    if (!provider || !provider._id.equals(inspection.propertyId.providerId)) {
      return res.status(403).json({ message: 'You do not own this property' });
    }
    if (!['confirmed', 'rescheduled'].includes(inspection.status)) {
      return res.status(400).json({
        message: `Cannot mark an inspection with status "${inspection.status}" as missed`,
      });
    }

    inspection.status = 'missed';
    await inspection.save();
    return res.json({ inspection });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to mark inspection as missed', error: err.message });
  }
}

// PUT /inspections/:id/complete  (provider, owner only) — marks the inspection as attended
async function completeInspection(req, res) {
  try {
    const inspection = await Inspection.findById(req.params.id).populate('propertyId');
    if (!inspection) return res.status(404).json({ message: 'Inspection not found' });

    const provider = await getProviderProfile(req.user._id);
    if (!provider || !provider._id.equals(inspection.propertyId.providerId)) {
      return res.status(403).json({ message: 'You do not own this property' });
    }
    if (!['confirmed', 'rescheduled'].includes(inspection.status)) {
      return res.status(400).json({ message: `Cannot complete an inspection with status "${inspection.status}"` });
    }

    inspection.status = 'completed';
    inspection.completedAt = new Date();
    await inspection.save();
    return res.json({ inspection });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to complete inspection', error: err.message });
  }
}

// PUT /inspections/:id/decision  (student only)  body: { decision: 'accepted'|'rejected' }
// Accepting automatically creates the Transaction — this is the
// "ACCEPT/REJECT -> PROCEED/TRANSACTION STATUS" step in the journey.
async function decideInspection(req, res) {
  try {
    const { decision, reason } = req.body;
    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'decision must be accepted or rejected' });
    }

    const inspection = await Inspection.findById(req.params.id);
    if (!inspection) return res.status(404).json({ message: 'Inspection not found' });

    const student = await getStudentProfile(req.user._id);
    if (!student || !student._id.equals(inspection.studentId)) {
      return res.status(403).json({ message: 'Not your inspection' });
    }
    if (inspection.status !== 'completed') {
      return res.status(400).json({ message: 'Inspection must be completed before a decision can be made' });
    }
    if (inspection.decision !== 'pending') {
      return res.status(409).json({ message: 'A decision has already been made for this inspection' });
    }

    inspection.decision = decision;
    if (decision === 'rejected' && reason) {
      inspection.rejectionReason = reason;
    }
    await inspection.save();

    let transaction = null;
    if (decision === 'accepted') {
      const property = await Property.findById(inspection.propertyId);
      const chargesTotal = (property.additionalCharges || []).reduce((sum, c) => sum + c.amount, 0);
      transaction = await Transaction.create({
        inspectionId: inspection._id,
        amount: property.price + chargesTotal,
      });

      // Take the property off the market — it's no longer available for
      // other students to request or find in search once someone has
      // accepted it and a transaction has started.
      property.availabilityStatus = 'booked';
      await property.save();
    }
    // On rejection, the property is left untouched — it stays 'available'.

    return res.json({ inspection, transaction });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to record decision', error: err.message });
  }
}

// DELETE /inspections/:id  (student only) — cancel before it's completed
async function cancelInspection(req, res) {
  try {
    const inspection = await Inspection.findById(req.params.id);
    if (!inspection) return res.status(404).json({ message: 'Inspection not found' });

    const student = await getStudentProfile(req.user._id);
    if (!student || !student._id.equals(inspection.studentId)) {
      return res.status(403).json({ message: 'Not your inspection' });
    }
    if (['completed', 'cancelled', 'missed'].includes(inspection.status)) {
      return res.status(400).json({ message: `Cannot cancel an inspection with status "${inspection.status}"` });
    }

    inspection.status = 'cancelled';
    await inspection.save();
    return res.json({ inspection });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to cancel inspection', error: err.message });
  }
}

module.exports = {
  requestInspection,
  getMyInspections,
  getReceivedInspections,
  getInspectionById,
  scheduleInspection,
  declineInspection,
  rescheduleInspection,
  missedInspection,
  completeInspection,
  decideInspection,
  cancelInspection,
};