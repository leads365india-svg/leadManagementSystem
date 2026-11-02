require('dotenv').config();
const mongoose = require('mongoose');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e){}

async function inspect() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const collections = await mongoose.connection.db.listCollections().toArray();
  const searchRegex = /Acme|Pallet|Warehouse/i;

  for (const c of collections) {
    const coll = mongoose.connection.db.collection(c.name);
    const docs = await coll.find({
      $or: [
        { businessName: searchRegex },
        { name: searchRegex },
        { title: searchRegex },
        { description: searchRegex }
      ]
    }).toArray();

    if (docs.length > 0) {
      console.log(`\nCollection [${c.name}] has ${docs.length} matching records:`);
      docs.forEach(d => {
        console.log({
          _id: d._id,
          tenantId: d.tenantId,
          name: d.name || d.businessName || d.title,
          category: d.category,
          sourceType: d.sourceType,
          createdAt: d.createdAt
        });
      });
    }
  }

  // Also list all records in TenantBusinessProfile, BusinessProduct, AIKnowledgeSource
  const profileColl = mongoose.connection.db.collection('tenantbusinessprofiles');
  const productColl = mongoose.connection.db.collection('businessproducts');
  const sourceColl = mongoose.connection.db.collection('aiknowledgesources');

  console.log('\n--- All TenantBusinessProfiles ---');
  const allProfiles = await profileColl.find({}).toArray();
  allProfiles.forEach(p => console.log({ _id: p._id, tenantId: p.tenantId, businessName: p.businessName }));

  console.log('\n--- All BusinessProducts ---');
  const allProducts = await productColl.find({}).toArray();
  allProducts.forEach(p => console.log({ _id: p._id, tenantId: p.tenantId, name: p.name }));

  console.log('\n--- All AIKnowledgeSources ---');
  const allSources = await sourceColl.find({}).toArray();
  allSources.forEach(s => console.log({ _id: s._id, tenantId: s.tenantId, title: s.title, sourceType: s.sourceType, status: s.status }));

  await mongoose.disconnect();
}

inspect().catch(err => {
  console.error('Inspection error:', err);
  process.exit(1);
});

