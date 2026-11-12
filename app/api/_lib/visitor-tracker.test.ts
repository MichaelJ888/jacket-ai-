import assert from 'node:assert/strict';
import test from 'node:test';
import { createVisitorLog } from './visitor-tracker.ts';

test('visitor logging stores bounded page/source and allowlisted request clues only', () => {
  const request = new Request(
    'https://jacket-ai.vercel.app/quote?utm_source=campaign&utm_medium=email&token=private',
    {
      headers: {
        'x-real-ip': '203.0.113.8',
        'x-vercel-ip-country': 'PH',
        'x-vercel-ip-country-region': 'NCR',
        'x-vercel-ip-city': 'Taguig',
        'x-vercel-ip-timezone': 'Asia/Manila',
        'accept-language': 'en-PH,en;q=0.9',
        'sec-ch-ua-platform': '"Windows"',
        'user-agent': 'Test Browser',
        referer: 'https://search.example/results?email=private',
        cookie: 'session=secret',
        authorization: 'Bearer secret',
        'x-forwarded-for': '203.0.113.8, 10.0.0.1',
      },
    },
  );

  const log = createVisitorLog(request);

  assert.equal(log.ip_address, '203.0.113.8');
  assert.equal(log.page_path, '/quote');
  assert.equal(log.user_agent, 'Test Browser');
  assert.equal(log.traffic_source, 'campaign');
  assert.equal(log.referrer, 'https://search.example');
  assert.equal(log.country, 'PH');
  assert.equal(log.region, 'NCR');
  assert.equal(log.city, 'Taguig');
  assert.deepEqual(log.request_headers, {
    'x-vercel-ip-country': 'PH',
    'x-vercel-ip-country-region': 'NCR',
    'x-vercel-ip-city': 'Taguig',
    'x-vercel-ip-timezone': 'Asia/Manila',
    'accept-language': 'en-PH,en;q=0.9',
    'sec-ch-ua-platform': '"Windows"',
  });
  assert.equal(JSON.stringify(log).includes('secret'), false);
});

test('invalid IP headers are not stored and absent referrers are direct traffic', () => {
  const request = new Request('https://jacket-ai.vercel.app/', {
    headers: {
      'x-real-ip': 'not-an-ip',
      'x-forwarded-for': 'spoofed, 10.0.0.1',
    },
  });

  const log = createVisitorLog(request);

  assert.equal(log.ip_address, null);
  assert.equal(log.traffic_source, 'direct');
  assert.equal(log.referrer, null);
});
