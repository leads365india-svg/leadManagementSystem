require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const http = require('http');
const crypto = require('crypto');
const { getJwtSecret } = require('../middleware/authMiddleware');
const { Integration } = require('../models/Integration');
const Lead = require('../models/Lead');
const User = require('../models/User');

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };

    let payload = null;
    if (body !== null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : null;
            resolve({ status: res.statusCode, headers: res.headers, data, raw });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, data: null, raw });
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tokenVersion: user.tokenVersion || 1,
    },
    getJwtSecret(),
    { expiresIn: '1h' }
  );
}

async function runTests() {
  console.log('================================================================');
  console.log('  TEST SUITE: WEBSITE LEAD INTEGRATIONS (ALL 6 PLATFORMS)       ');
  console.log('================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  const tenantAUser = await User.findOne({ email: 'anil@test.com' });
  const tenantBUser = await User.findOne({ email: 'sara@test.com' });

  if (!tenantAUser || !tenantBUser) {
    throw new Error('Required test users (anil@test.com, sara@test.com) not found');
  }

  const tokenA = generateToken(tenantAUser);
  const tokenB = generateToken(tenantBUser);
  const tenantAId = tenantAUser.tenantId;
  const tenantBId = tenantBUser.tenantId;

  let testPassed = 0;
  let testFailed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      testPassed++;
    } else {
      console.error(`  [FAIL] ${testName} - ${details}`);
      testFailed++;
    }
  }

  const createdIntegrationIds = [];
  const createdLeadIds = [];

  try {
    // -------------------------------------------------------------
    // 1. TEST WORDPRESS INTEGRATION
    // -------------------------------------------------------------
    console.log('1. Testing WordPress Integration...');
    const wpCreateRes = await makeRequest(
      'POST',
      '/api/integrations',
      {
        name: 'Official WordPress Blog',
        type: 'wordpress',
        settings: {
          websiteDomain: 'mycompany.com',
          defaultStatus: 'New',
          leadSource: 'WordPress Blog',
          duplicateHandling: 'reject',
        },
      },
      { Authorization: `Bearer ${tokenA}` }
    );

    assert(wpCreateRes.status === 201, 'Create WordPress integration returns 201', JSON.stringify(wpCreateRes.data));
    const wpApiKey = wpCreateRes.data?.rawApiKey;
    const wpSiteKey = wpCreateRes.data?.siteKey;
    const wpIntegrationId = wpCreateRes.data?.data?._id || wpCreateRes.data?.data?.id;
    assert(Boolean(wpApiKey && wpSiteKey && wpIntegrationId), 'WordPress integration returned rawApiKey, siteKey, and ID');
    createdIntegrationIds.push(wpIntegrationId);

    // Get Snippets for WordPress
    const wpSnippetsRes = await makeRequest('GET', `/api/integrations/${wpIntegrationId}/snippets`, null, {
      Authorization: `Bearer ${tokenA}`,
    });
    assert(wpSnippetsRes.status === 200, 'GET /snippets returns 200 for WordPress');
    assert(
      wpSnippetsRes.data?.data?.snippets?.wordpress?.customPhpHook?.includes('leads365_forward_cf7_lead'),
      'WordPress snippets contain custom PHP hook'
    );

    // Ingest WordPress Lead using API Key
    const wpLeadPayload = {
      name: 'WP Contact Lead',
      email: `wp-lead-${Date.now()}@example.com`,
      phone: '+919876543211',
      message: 'Interested in enterprise WordPress hosting',
      source: 'WordPress Blog',
      formId: 'cf7_main_contact',
    };
    const wpIngestRes = await makeRequest('POST', '/api/integrations/leads/website', wpLeadPayload, {
      'x-api-key': wpApiKey,
    });
    assert(wpIngestRes.status === 201, 'WordPress lead ingested via x-api-key returns 201', JSON.stringify(wpIngestRes.data));
    const wpLeadId = wpIngestRes.data?.data?.id;
    if (wpLeadId) createdLeadIds.push(wpLeadId);

    // Verify lead in MongoDB
    const wpDbLead = await Lead.findById(wpLeadId);
    assert(wpDbLead && wpDbLead.tenantId === tenantAId, 'WordPress lead created with correct tenantId');
    assert(wpDbLead && (wpDbLead.source === 'WordPress Blog' || wpDbLead.source === 'WordPress'), 'WordPress lead has correct source', `Source was: ${wpDbLead?.source}`);

    // -------------------------------------------------------------
    // 2. TEST HTML / JAVASCRIPT INTEGRATION & BOT HONEYPOT
    // -------------------------------------------------------------
    console.log('\n2. Testing HTML / JavaScript Integration & Honeypot...');
    const htmlCreateRes = await makeRequest(
      'POST',
      '/api/integrations',
      {
        name: 'Static Landing Page',
        type: 'html',
        settings: {
          websiteDomain: 'landing.example.com',
          allowedOrigins: ['http://localhost:3000', 'https://landing.example.com'],
          duplicateHandling: 'reject',
        },
      },
      { Authorization: `Bearer ${tokenA}` }
    );
    assert(htmlCreateRes.status === 201, 'Create HTML integration returns 201');
    const htmlSiteKey = htmlCreateRes.data?.siteKey;
    const htmlIntegrationId = htmlCreateRes.data?.data?._id || htmlCreateRes.data?.data?.id;
    createdIntegrationIds.push(htmlIntegrationId);

    // Test honeypot bot trap rejection
    const botPayload = {
      name: 'Spam Bot',
      email: 'bot@spam.com',
      phone: '1234567890',
      _hp_trap: 'I am a hidden bot input',
    };
    const botRes = await makeRequest('POST', '/api/integrations/leads/website', botPayload, {
      'x-site-key': htmlSiteKey,
      origin: 'https://landing.example.com',
    });
    assert(botRes.status === 400 && botRes.data?.error?.includes('honeypot'), 'Honeypot bot submission rejected with 400');

    // Valid HTML browser submission with siteKey
    const validHtmlPayload = {
      name: 'Valid Browser Visitor',
      email: `browser-${Date.now()}@example.com`,
      phone: '+14155552671',
      message: 'Looking for a demo',
      _hp_trap: '', // Empty honeypot
      landingPage: 'https://landing.example.com/demo',
    };
    const htmlIngestRes = await makeRequest('POST', '/api/integrations/leads/website', validHtmlPayload, {
      'x-site-key': htmlSiteKey,
      origin: 'https://landing.example.com',
    });
    assert(htmlIngestRes.status === 201, 'HTML client form submission with siteKey returns 201', JSON.stringify(htmlIngestRes.data));
    const htmlLeadId = htmlIngestRes.data?.data?.id;
    if (htmlLeadId) createdLeadIds.push(htmlLeadId);

    // -------------------------------------------------------------
    // 3. TEST PHP INTEGRATION WITH HMAC SIGNATURE & TIMESTAMP
    // -------------------------------------------------------------
    console.log('\n3. Testing PHP Integration (HMAC & Timestamp)...');
    const phpCreateRes = await makeRequest(
      'POST',
      '/api/integrations',
      {
        name: 'Backend PHP App',
        type: 'php',
        settings: {
          defaultStatus: 'New',
          leadSource: 'PHP Backend',
        },
      },
      { Authorization: `Bearer ${tokenA}` }
    );
    assert(phpCreateRes.status === 201, 'Create PHP integration returns 201');
    const phpApiKey = phpCreateRes.data?.rawApiKey;
    const phpIntegrationId = phpCreateRes.data?.data?._id || phpCreateRes.data?.data?.id;
    createdIntegrationIds.push(phpIntegrationId);

    const phpPayload = {
      name: 'PHP Secure Lead',
      email: `php-${Date.now()}@example.com`,
      phone: '+442071838750',
      message: 'Server-to-server submission from custom PHP checkout',
    };
    const jsonStr = JSON.stringify(phpPayload);
    const validTimestamp = Date.now();
    const validHmac = crypto.createHmac('sha256', phpApiKey).update(jsonStr).digest('hex');
    const idempotencyKey = `php_idemp_${Date.now()}_${Math.random()}`;

    // Test with invalid HMAC
    const badHmacRes = await makeRequest('POST', '/api/integrations/leads/website', phpPayload, {
      'x-api-key': phpApiKey,
      'x-signature-256': 'invalid_hmac_hash_1234567890abcdef',
      'x-timestamp': String(validTimestamp),
    });
    assert(badHmacRes.status === 401, 'PHP request with invalid HMAC rejected with 401', JSON.stringify(badHmacRes.data));

    // Test with expired timestamp (> 5 minutes ago)
    const expiredTs = Date.now() - 360000; // 6 minutes ago
    const expiredHmacRes = await makeRequest('POST', '/api/integrations/leads/website', phpPayload, {
      'x-api-key': phpApiKey,
      'x-signature-256': validHmac,
      'x-timestamp': String(expiredTs),
    });
    assert(expiredHmacRes.status === 401, 'PHP request with expired timestamp rejected with 401', JSON.stringify(expiredHmacRes.data));

    // Valid PHP request with valid HMAC + timestamp + idempotency
    const validPhpRes = await makeRequest('POST', '/api/integrations/leads/website', phpPayload, {
      'x-api-key': phpApiKey,
      'x-signature-256': validHmac,
      'x-timestamp': String(validTimestamp),
      'x-idempotency-key': idempotencyKey,
    });
    assert(validPhpRes.status === 201, 'PHP request with valid HMAC, timestamp, and idempotency returns 201', JSON.stringify(validPhpRes.data));
    const phpLeadId = validPhpRes.data?.data?.id;
    if (phpLeadId) createdLeadIds.push(phpLeadId);

    // Replay identical request with same idempotency key -> Must return 200 idempotent result
    const replayPhpRes = await makeRequest('POST', '/api/integrations/leads/website', phpPayload, {
      'x-api-key': phpApiKey,
      'x-signature-256': validHmac,
      'x-timestamp': String(validTimestamp),
      'x-idempotency-key': idempotencyKey,
    });
    assert(
      replayPhpRes.status === 200 && replayPhpRes.data?.idempotent === true,
      'Idempotent duplicate submission safely returns existing lead without duplication'
    );

    // -------------------------------------------------------------
    // 4. TEST REACT INTEGRATION & CUSTOM FIELD MAPPINGS
    // -------------------------------------------------------------
    console.log('\n4. Testing React Integration & Field Mapping Engine...');
    const reactCreateRes = await makeRequest(
      'POST',
      '/api/integrations',
      {
        name: 'React SPA Website',
        type: 'react',
        fieldMapping: [
          { sourceField: 'fullName', targetField: 'name', transform: 'trim' },
          { sourceField: 'emailAddress', targetField: 'email', transform: 'lowercase' },
          { sourceField: 'mobileNumber', targetField: 'phone', transform: 'phone_e164' },
          { sourceField: 'organization', targetField: 'company', transform: 'trim' },
          { sourceField: 'productChoice', targetField: 'product', transform: 'none' },
          { sourceField: 'estimatedBudget', targetField: 'budget', transform: 'none' },
        ],
        settings: {
          leadSource: 'React App',
          defaultStatus: 'New',
        },
      },
      { Authorization: `Bearer ${tokenA}` }
    );
    assert(reactCreateRes.status === 201, 'Create React integration with field mapping returns 201');
    const reactSiteKey = reactCreateRes.data?.siteKey;
    const reactIntegrationId = reactCreateRes.data?.data?._id || reactCreateRes.data?.data?.id;
    createdIntegrationIds.push(reactIntegrationId);

    const reactPayload = {
      fullName: '  Sarah Jenkins  ',
      emailAddress: 'SARAH.JENKINS@EXAMPLE.COM',
      mobileNumber: '91-987-654-3219',
      organization: 'Acme Corp Technologies',
      productChoice: 'Enterprise CRM Suite',
      estimatedBudget: '$50,000 - $100,000',
      message: 'Need 50 agent licenses',
    };
    const reactIngestRes = await makeRequest('POST', '/api/integrations/leads/website', reactPayload, {
      'x-site-key': reactSiteKey,
      origin: 'http://localhost:3000',
    });
    assert(reactIngestRes.status === 201, 'React submission with field mapping returns 201', JSON.stringify(reactIngestRes.data));
    const reactLeadId = reactIngestRes.data?.data?.id;
    if (reactLeadId) createdLeadIds.push(reactLeadId);

    const reactDbLead = await Lead.findById(reactLeadId);
    assert(reactDbLead && reactDbLead.name === 'Sarah Jenkins', 'Mapped name trimmed properly ("Sarah Jenkins")');
    assert(reactDbLead && reactDbLead.email === 'sarah.jenkins@example.com', 'Mapped email lowercased properly');
    assert(reactDbLead && reactDbLead.company === 'Acme Corp Technologies', 'Mapped company set properly');
    assert(
      reactDbLead &&
        reactDbLead.metadata?.customFields?.product === 'Enterprise CRM Suite' &&
        reactDbLead.metadata?.customFields?.budget === '$50,000 - $100,000',
      'Custom fields (product, budget) preserved in metadata.customFields'
    );

    // -------------------------------------------------------------
    // 5. TEST NEXT.JS INTEGRATION (SERVER SUBMISSION)
    // -------------------------------------------------------------
    console.log('\n5. Testing Next.js Integration...');
    const nextCreateRes = await makeRequest(
      'POST',
      '/api/integrations',
      {
        name: 'Next.js App Router Site',
        type: 'nextjs',
        settings: {
          leadSource: 'Next.js Web',
        },
      },
      { Authorization: `Bearer ${tokenA}` }
    );
    assert(nextCreateRes.status === 201, 'Create Next.js integration returns 201');
    const nextApiKey = nextCreateRes.data?.rawApiKey;
    const nextIntegrationId = nextCreateRes.data?.data?._id || nextCreateRes.data?.data?.id;
    createdIntegrationIds.push(nextIntegrationId);

    const nextLeadPayload = {
      name: 'Next.js Lead',
      email: `nextjs-${Date.now()}@example.com`,
      phone: '+14155559812',
      message: 'Submitted via Next.js Server Action',
    };
    const nextIngestRes = await makeRequest('POST', '/api/integrations/leads/website', nextLeadPayload, {
      'x-api-key': nextApiKey,
    });
    assert(nextIngestRes.status === 201, 'Next.js lead ingested via server API key returns 201');
    const nextLeadId = nextIngestRes.data?.data?.id;
    if (nextLeadId) createdLeadIds.push(nextLeadId);

    // -------------------------------------------------------------
    // 6. TEST THIRD-PARTY WEBHOOK INTEGRATION
    // -------------------------------------------------------------
    console.log('\n6. Testing Custom Webhook Integration...');
    const webhookCreateRes = await makeRequest(
      'POST',
      '/api/integrations',
      {
        name: 'Custom ERP Webhook',
        type: 'webhook',
        settings: {
          leadSource: 'ERP Ingest',
        },
      },
      { Authorization: `Bearer ${tokenA}` }
    );
    assert(webhookCreateRes.status === 201, 'Create Webhook integration returns 201');
    const webhookApiKey = webhookCreateRes.data?.rawApiKey;
    const webhookIntegrationId = webhookCreateRes.data?.data?._id || webhookCreateRes.data?.data?.id;
    createdIntegrationIds.push(webhookIntegrationId);

    const webhookLeadPayload = {
      name: 'ERP Customer Sync',
      email: `erp-${Date.now()}@example.com`,
      phone: '+919988776655',
      message: 'Synchronized from legacy CRM ERP webhook',
    };
    const webhookIngestRes = await makeRequest('POST', '/api/integrations/leads/website', webhookLeadPayload, {
      'x-api-key': webhookApiKey,
    });
    assert(webhookIngestRes.status === 201, 'Custom webhook lead returns 201');
    const webhookLeadId = webhookIngestRes.data?.data?.id;
    if (webhookLeadId) createdLeadIds.push(webhookLeadId);

    // -------------------------------------------------------------
    // 7. TEST INTERACTIVE TESTING ENDPOINT (POST /:id/test)
    // -------------------------------------------------------------
    console.log('\n7. Testing POST /api/integrations/:id/test Endpoint...');
    const testEndpointRes = await makeRequest(
      'POST',
      `/api/integrations/${wpIntegrationId}/test`,
      {
        payload: {
          name: 'Manual Test Click',
          email: 'manual-test@example.com',
          phone: '+919876543210',
          message: 'Testing from UI Test Lead button',
        },
      },
      { Authorization: `Bearer ${tokenA}` }
    );
    assert(testEndpointRes.status === 200, 'POST /:id/test returns 200 OK');
    assert(testEndpointRes.data?.data?.isTest === true, 'Test lead returned isTest: true without polluting production leads');

    // -------------------------------------------------------------
    // 8. TEST TENANT ISOLATION
    // -------------------------------------------------------------
    console.log('\n8. Testing Tenant Isolation...');
    // Tenant B attempts to read Tenant A's integration
    const tenantBCrossGet = await makeRequest('GET', `/api/integrations/${wpIntegrationId}`, null, {
      Authorization: `Bearer ${tokenB}`,
    });
    assert(tenantBCrossGet.status === 404, 'Tenant B cannot GET Tenant A integration (returns 404)');

    // Tenant B attempts to get snippets for Tenant A's integration
    const tenantBCrossSnippets = await makeRequest('GET', `/api/integrations/${wpIntegrationId}/snippets`, null, {
      Authorization: `Bearer ${tokenB}`,
    });
    assert(tenantBCrossSnippets.status === 404, 'Tenant B cannot GET snippets for Tenant A integration (returns 404)');

    // Tenant B attempts to update Tenant A's integration
    const tenantBCrossUpdate = await makeRequest(
      'PUT',
      `/api/integrations/${wpIntegrationId}`,
      { name: 'Hacked Integration' },
      { Authorization: `Bearer ${tokenB}` }
    );
    assert(tenantBCrossUpdate.status === 404, 'Tenant B cannot PUT Tenant A integration (returns 404)');

    // Tenant B attempts to delete Tenant A's integration
    const tenantBCrossDelete = await makeRequest('DELETE', `/api/integrations/${wpIntegrationId}`, null, {
      Authorization: `Bearer ${tokenB}`,
    });
    assert(tenantBCrossDelete.status === 404, 'Tenant B cannot DELETE Tenant A integration (returns 404)');
  } finally {
    // -------------------------------------------------------------
    // CLEANUP
    // -------------------------------------------------------------
    console.log('\nCleaning up created test records...');
    if (createdIntegrationIds.length > 0) {
      await Integration.deleteMany({ _id: { $in: createdIntegrationIds } }).setOptions({ skipTenantFilter: true });
      console.log(`  Deleted ${createdIntegrationIds.length} test integrations.`);
    }
    if (createdLeadIds.length > 0) {
      await Lead.deleteMany({ _id: { $in: createdLeadIds } }).setOptions({ skipTenantFilter: true });
      console.log(`  Deleted ${createdLeadIds.length} test leads.`);
    }
  }

  console.log('\n================================================================');
  console.log(`  SUMMARY: ${testPassed} Passed, ${testFailed} Failed`);
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(testFailed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
