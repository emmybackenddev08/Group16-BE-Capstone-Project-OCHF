const { Transaction, Inspection, Property, StudentProfile, ProviderProfile } = require('../model/collectionsModel');

async function getStudentProfile(userId) {
  return StudentProfile.findOne({ userId });
}
async function getProviderProfile(userId) {
  return ProviderProfile.findOne({ userId });
}

// GET /transactions/mine  (student)
async function getMyTransactions(req, res) {
  try {
    const student = await getStudentProfile(req.user._id);
    if (!student) return res.status(404).json({ message: 'Student profile not found' });

    const inspections = await Inspection.find({ studentId: student._id }).select('_id');
    const inspectionIds = inspections.map((i) => i._id);

    const transactions = await Transaction.find({ inspectionId: { $in: inspectionIds } }).populate({
      path: 'inspectionId',
      populate: { path: 'propertyId' },
    });
    return res.json({ transactions });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch transactions', error: err.message });
  }
}

// GET /transactions/received  (provider)
async function getReceivedTransactions(req, res) {
  try {
    const provider = await getProviderProfile(req.user._id);
    if (!provider) return res.status(404).json({ message: 'Provider profile not found' });

    const properties = await Property.find({ providerId: provider._id }).select('_id');
    const propertyIds = properties.map((p) => p._id);

    const inspections = await Inspection.find({ propertyId: { $in: propertyIds } }).select('_id');
    const inspectionIds = inspections.map((i) => i._id);

    const transactions = await Transaction.find({ inspectionId: { $in: inspectionIds } }).populate({
      path: 'inspectionId',
      populate: { path: 'propertyId' },
    });
    return res.json({ transactions });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch transactions', error: err.message });
  }
}

// Resolves whether the requesting user is the student or the owning
// provider on this transaction's inspection, or neither.
async function getParticipantRole(userId, transaction) {
  const inspection = await Inspection.findById(transaction.inspectionId).populate('propertyId');
  const student = await getStudentProfile(userId);
  const provider = await getProviderProfile(userId);

  if (student && student._id.equals(inspection.studentId)) return { role: 'student', inspection };
  if (provider && inspection.propertyId && provider._id.equals(inspection.propertyId.providerId)) {
    return { role: 'provider', inspection };
  }
  return { role: null, inspection };
}

// GET /transactions/:id  (either participant)
async function getTransactionById(req, res) {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    const { role } = await getParticipantRole(req.user._id, transaction);
    if (!role) return res.status(403).json({ message: 'Not authorized to view this transaction' });

    return res.json({ transaction });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch transaction', error: err.message });
  }
}

// Allowed forward moves — no skipping straight to completed, no reopening
// a completed/cancelled transaction.
const VALID_TRANSITIONS = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

// PUT /transactions/:id/status  (either participant)  body: { status }
async function updateTransactionStatus(req, res) {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    const { role } = await getParticipantRole(req.user._id, transaction);
    if (!role) return res.status(403).json({ message: 'Not authorized to update this transaction' });

    const allowed = VALID_TRANSITIONS[transaction.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: `Cannot move status from "${transaction.status}" to "${status}"`,
      });
    }

    transaction.status = status;
    await transaction.save();

    //cancelling a transaction reopens the property for booking
    if (status==='cancelled') {
      const inspection = await inspection.findById(transaction.inspectionId)
      if (inspection) {
        await Property.findByIdAndUpdate(inspection.propertyId, { availabilityStatus: 'available'})
      }
    }
    return res.json({ transaction });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update transaction', error: err.message });
  }
}

module.exports = {
  getMyTransactions,
  getReceivedTransactions,
  getTransactionById,
  updateTransactionStatus,
};