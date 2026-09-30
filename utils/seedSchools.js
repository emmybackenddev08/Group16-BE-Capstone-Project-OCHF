require('dotenv').config();
const mongoose = require('mongoose');
const { School } = require('../model/collectionsModel');

const INITIAL_SCHOOLS = [
  {
    name: 'University of Lagos (UNILAG)',
    location: {
      type: 'Point',
      coordinates: [3.3879, 6.5173], // [longitude, latitude] - Akoka, Lagos
    },
  },
  {
    name: 'Yaba College of Technology (YABATECH)',
    location: {
      type: 'Point',
      coordinates: [3.3764, 6.5186], // [longitude, latitude] - Yaba, Lagos
    },
  },
  {
    name: 'Lagos State University (LASU)',
    location: {
      type: 'Point',
      coordinates: [3.2014, 6.4674], // [longitude, latitude] - Ojo, Lagos
    },
  },
  {
    name: 'University of Ibadan (UI)',
    location: {
      type: 'Point',
      coordinates: [3.9000, 7.4443], // [longitude, latitude] - Ibadan, Oyo
    },
  },
  {
    name: 'Obafemi Awolowo University (OAU)',
    location: {
      type: 'Point',
      coordinates: [4.5284, 7.5188], // [longitude, latitude] - Ile-Ife, Osun
    },
  },
  {
    name: 'Federal University of Technology Akure (FUTA)',
    location: {
      type: 'Point',
      coordinates: [5.1500, 7.3000], // [longitude, latitude] - Akure, Ondo
    },
  },
];

async function seedSchools() {
  try {
    if (!process.env.MONGOATLAS_URI) {
      console.error('Error: MONGOATLAS_URI is not defined in your .env file.');
      process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGOATLAS_URI);
    console.log('Connected to MongoDB successfully.');

    let addedCount = 0;
    for (const schoolData of INITIAL_SCHOOLS) {
      const exists = await School.findOne({ name: schoolData.name });
      if (!exists) {
        const created = await School.create(schoolData);
        console.log(`+ Seeded: ${created.name} (ID: ${created._id})`);
        addedCount += 1;
      } else {
        console.log(`= Already exists: ${exists.name} (ID: ${exists._id})`);
      }
    }

    console.log('\n=============================================');
    console.log(`✅ School seeding complete! Added: ${addedCount}`);
    console.log('=============================================\n');

    await mongoose.disconnect();
  } catch (err) {
    console.error('Seeding schools failed:', err.message);
    process.exit(1);
  }
}

seedSchools();
