require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const http = require('http');
const { getJwtSecret } = require('../middleware/authMiddleware');
const Device = require('../models/Device');
const User = require('../models/User');

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      url,
      {
        method,
        headers,
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
  console.log('====================================================');
  console.log('  TEST SUITE: /api/devices ROUTE COLLISION FIX TEST ');
  console.log('====================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB for test verification.\n');

  const tenantAUser = await User.findOne({ email: 'anil@test.com' });
  const tenantBUser = await User.findOne({ email: 'sara@test.com' });

  if (!tenantAUser || !tenantBUser) {
    throw new Error('Required test users (anil@test.com, sara@test.com) not found');
  }

  const tokenA = generateToken(tenantAUser);
  const tokenB = generateToken(tenantBUser);

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

  // 1. Unauthenticated GET /api/devices
  console.log('1. Testing Unauthenticated Access...');
  const unauthRes = await makeRequest('GET', '/api/devices');
  assert(
    unauthRes.status === 401,
    'GET /api/devices without token returns 401 Unauthorized',
    `Received status: ${unauthRes.status}`
  );

  // 2. Authenticated GET /api/devices returns devices, NOT calls
  console.log('\n2. Testing Authenticated GET /api/devices...');
  const listRes = await makeRequest('GET', '/api/devices', null, tokenA);
  assert(
    listRes.status === 200,
    'GET /api/devices returns 200 OK',
    `Status: ${listRes.status}`
  );
  assert(
    listRes.data && listRes.data.success === true,
    'GET /api/devices response has success: true',
    JSON.stringify(listRes.data)
  );
  assert(
    listRes.data && (Array.isArray(listRes.data.devices) || (listRes.data.data && Array.isArray(listRes.data.data.devices))),
    'GET /api/devices returns an array of devices in data.devices or devices',
    JSON.stringify(listRes.data)
  );
  // Verify it does not contain call logs properties like callDuration or callerNumber
  const sampleDevice = (listRes.data.devices || listRes.data.data?.devices || [])[0];
  if (sampleDevice) {
    assert(
      sampleDevice.callDuration === undefined && sampleDevice.recordingUrl === undefined,
      'GET /api/devices item does NOT have call log fields (no collision with callRoutes)',
      `Found fields: ${Object.keys(sampleDevice).join(', ')}`
    );
  } else {
    console.log('  [INFO] No existing devices for Tenant A, creating one next.');
  }

  // 3. Backward compatible alias GET /api/devices/all
  console.log('\n3. Testing GET /api/devices/all alias...');
  const aliasRes = await makeRequest('GET', '/api/devices/all', null, tokenA);
  assert(
    aliasRes.status === 200 && aliasRes.data?.success === true,
    'GET /api/devices/all returns 200 OK and success: true'
  );

  // 4. POST /api/devices to create a device
  console.log('\n4. Testing POST /api/devices (Device Registration)...');
  const newDeviceData = {
    label: 'Automated Test Pixel 8',
    model: 'Pixel 8 Pro',
    osVersion: 'Android 14',
    appVersion: '1.2.0',
    pushToken: 'push-token-test-12345',
  };
  const createRes = await makeRequest('POST', '/api/devices', newDeviceData, tokenA);
  assert(
    createRes.status === 201,
    'POST /api/devices returns 201 Created',
    `Status: ${createRes.status}, data: ${JSON.stringify(createRes.data)}`
  );
  const createdDevice = createRes.data?.data || createRes.data?.device;
  assert(
    createdDevice && createdDevice.tenantId === tenantAUser.tenantId,
    'Created device contains correct tenantId for Tenant A',
    `tenantId: ${createdDevice?.tenantId}`
  );
  console.log('Created device response:', createRes.data);
  const testDeviceId = createdDevice?._id || createdDevice?.id;

  if (testDeviceId) {
    // 5. GET /api/devices/:id
    console.log('\n5. Testing GET /api/devices/:id...');
    const getRes = await makeRequest('GET', `/api/devices/${testDeviceId}`, null, tokenA);
    assert(
      getRes.status === 200,
      'GET /api/devices/:id returns 200 OK',
      `Status: ${getRes.status}`
    );
    assert(
      getRes.data?.data?._id === testDeviceId || getRes.data?.device?._id === testDeviceId,
      'GET /api/devices/:id returns the exact created device'
    );

    // 6. PATCH /api/devices/:id/status
    console.log('\n6. Testing PATCH /api/devices/:id/status...');
    const revokeRes = await makeRequest(
      'PATCH',
      `/api/devices/${testDeviceId}/status`,
      { status: 'revoked' },
      tokenA
    );
    assert(
      revokeRes.status === 200,
      'PATCH /api/devices/:id/status with "revoked" returns 200 OK',
      `Status: ${revokeRes.status}, data: ${JSON.stringify(revokeRes.data)}`
    );
    const revokedStatus = revokeRes.data?.data?.status || revokeRes.data?.device?.status;
    assert(
      revokedStatus && revokedStatus.toLowerCase() === 'revoked',
      'Device status changed to "revoked"',
      `Received status: ${revokedStatus}`
    );

    // Verify in DB directly
    const dbDevice = await Device.findById(testDeviceId);
    assert(
      dbDevice && dbDevice.status && dbDevice.status.toLowerCase() === 'revoked',
      'Device document in database reflects status "revoked"',
      `DB status: ${dbDevice?.status}`
    );

    // Set back to active
    const activeRes = await makeRequest(
      'PATCH',
      `/api/devices/${testDeviceId}/status`,
      { status: 'active' },
      tokenA
    );
    const activeStatus = activeRes.data?.data?.status || activeRes.data?.device?.status;
    assert(
      activeRes.status === 200 && activeStatus && activeStatus.toLowerCase() === 'active',
      'PATCH /api/devices/:id/status with "active" returns 200 OK and active',
      `Received status: ${activeStatus}`
    );

    // Test invalid status
    const invalidStatusRes = await makeRequest(
      'PATCH',
      `/api/devices/${testDeviceId}/status`,
      { status: 'invalid_status_xyz' },
      tokenA
    );
    assert(
      invalidStatusRes.status === 400,
      'PATCH /api/devices/:id/status with invalid status returns 400 Bad Request',
      `Status: ${invalidStatusRes.status}`
    );

    // 7. Tenant Isolation Tests (Tenant B accessing Tenant A device)
    console.log('\n7. Testing Tenant Isolation...');
    const tenantBCrossGet = await makeRequest('GET', `/api/devices/${testDeviceId}`, null, tokenB);
    assert(
      tenantBCrossGet.status === 404,
      'Tenant B cannot GET Tenant A device (returns 404 Not Found)',
      `Status: ${tenantBCrossGet.status}`
    );

    const tenantBCrossPatch = await makeRequest(
      'PATCH',
      `/api/devices/${testDeviceId}/status`,
      { status: 'revoked' },
      tokenB
    );
    assert(
      tenantBCrossPatch.status === 404,
      'Tenant B cannot PATCH Tenant A device status (returns 404 Not Found)',
      `Status: ${tenantBCrossPatch.status}`
    );

    // 8. Cleanup test device
    await Device.deleteOne({ _id: testDeviceId });
    console.log(`\n  [CLEANUP] Deleted test device ${testDeviceId}`);
  }

  // 9. Call routes regression test
  console.log('\n8. Testing Call Routes Regression (GET /api/calls)...');
  const callsRes = await makeRequest('GET', '/api/calls', null, tokenA);
  assert(
    callsRes.status === 200,
    'GET /api/calls returns 200 OK (calls endpoint remains functional)',
    `Status: ${callsRes.status}`
  );
  assert(
    callsRes.data && (callsRes.data.success === true || callsRes.data.calls !== undefined || callsRes.data.data !== undefined),
    'GET /api/calls returns calls payload correctly',
    JSON.stringify(callsRes.data).substring(0, 150)
  );

  console.log('\n====================================================');
  console.log(`  SUMMARY: ${testPassed} Passed, ${testFailed} Failed`);
  console.log('====================================================\n');

  await mongoose.disconnect();
  process.exit(testFailed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
