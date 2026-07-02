import 'dotenv/config';
import express from 'express';
import { google } from 'googleapis';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_REFRESH_TOKEN
} = process.env;

function oauthClient() {
  const client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  if (GOOGLE_REFRESH_TOKEN) {
    client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  }

  return client;
}

async function gaClient() {
  const auth = oauthClient();
  return google.analyticsdata({ version: 'v1beta', auth });
}

async function adminClient() {
  const auth = oauthClient();
  return google.analyticsadmin({ version: 'v1beta', auth });
}

function text(data: any) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
      }
    ]
  };
}

function createServer() {
const server = new McpServer({
  name: 'ga4-mcp',
  version: '1.0.0'
});

server.tool(
  'list_ga4_properties',
  'List GA4 accounts and properties available to the authenticated Google account.',
  {},
  async () => {
    const admin = await adminClient();
    const accountsRes = await admin.accounts.list();
    const accounts = accountsRes.data.accounts || [];

    const output: any[] = [];

    for (const account of accounts) {
      const propsRes = await admin.properties.list({
        filter: `parent:${account.name}`
      });

      output.push({
        account: account.displayName,
        accountName: account.name,
        properties: (propsRes.data.properties || []).map((p: any) => ({
          displayName: p.displayName,
          property: p.name,
          propertyId: p.name?.replace('properties/', ''),
          timeZone: p.timeZone,
          currencyCode: p.currencyCode
        }))
      });
    }

    return text(output);
  }
);

server.tool(
  'get_ga4_traffic_summary',
  'Get GA4 traffic summary for a property and date range.',
  {
    propertyId: z.string(),
    startDate: z.string().describe('YYYY-MM-DD or relative date like 30daysAgo'),
    endDate: z.string().describe('YYYY-MM-DD or today')
  },
  async ({ propertyId, startDate, endDate }) => {
    const ga = await gaClient();

    const res = await ga.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'screenPageViews' },
          { name: 'engagedSessions' },
          { name: 'conversions' }
        ]
      }
    });

    return text(res.data);
  }
);

server.tool(
  'get_ga4_top_landing_pages',
  'Get top landing pages from GA4.',
  {
    propertyId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    limit: z.number().default(20)
  },
  async ({ propertyId, startDate, endDate, limit }) => {
    const ga = await gaClient();

    const res = await ga.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'engagedSessions' },
          { name: 'conversions' }
        ],
        limit: String(limit)
      }
    });

    return text(res.data);
  }
);

server.tool(
  'get_ga4_traffic_by_channel',
  'Get traffic grouped by GA4 default channel group, source and medium.',
  {
    propertyId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    limit: z.number().default(50)
  },
  async ({ propertyId, startDate, endDate, limit }) => {
    const ga = await gaClient();

    const res = await ga.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [
          { name: 'sessionDefaultChannelGroup' },
          { name: 'sessionSource' },
          { name: 'sessionMedium' }
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'conversions' }
        ],
        limit: String(limit)
      }
    });

    return text(res.data);
  }
);

server.tool(
  'compare_ga4_date_ranges',
  'Compare GA4 traffic between two date ranges.',
  {
    propertyId: z.string(),
    currentStart: z.string(),
    currentEnd: z.string(),
    previousStart: z.string(),
    previousEnd: z.string()
  },
  async ({ propertyId, currentStart, currentEnd, previousStart, previousEnd }) => {
    const ga = await gaClient();

    const res = await ga.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [
          { name: 'current', startDate: currentStart, endDate: currentEnd },
          { name: 'previous', startDate: previousStart, endDate: previousEnd }
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'screenPageViews' },
          { name: 'engagedSessions' },
          { name: 'conversions' }
        ]
      }
    });

    return text(res.data);
  }
);


server.tool(
  'analyse_organic_performance',
  'Analyse organic traffic quality, engagement and conversions for a GA4 property.',
  {
    propertyId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    limit: z.number().default(25)
  },
  async ({ propertyId, startDate, endDate, limit }) => {
    const ga = await gaClient();
    const res = await ga.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'deviceCategory' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'engagedSessions' },
          { name: 'engagementRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViews' },
          { name: 'conversions' }
        ],
        dimensionFilter: {
          filter: {
            fieldName: 'sessionDefaultChannelGroup',
            stringFilter: { matchType: 'EXACT', value: 'Organic Search' }
          }
        },
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: String(limit)
      }
    });
    return text(res.data);
  }
);

server.tool(
  'analyse_landing_page',
  'Diagnose behaviour and conversion performance for one landing page.',
  {
    propertyId: z.string(),
    pagePath: z.string().describe('Example: /property/for-sale/'),
    startDate: z.string(),
    endDate: z.string()
  },
  async ({ propertyId, pagePath, startDate, endDate }) => {
    const ga = await gaClient();
    const res = await ga.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'sessionDefaultChannelGroup' }, { name: 'deviceCategory' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'engagedSessions' },
          { name: 'engagementRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViews' },
          { name: 'conversions' },
          { name: 'eventCount' }
        ],
        dimensionFilter: {
          filter: {
            fieldName: 'landingPagePlusQueryString',
            stringFilter: { matchType: 'CONTAINS', value: pagePath }
          }
        },
        limit: '50'
      }
    });
    return text(res.data);
  }
);

server.tool(
  'analyse_conversion_drop',
  'Compare conversion performance between two date ranges and show where the drop may be coming from.',
  {
    propertyId: z.string(),
    currentStart: z.string(),
    currentEnd: z.string(),
    previousStart: z.string(),
    previousEnd: z.string(),
    channel: z.string().default('Organic Search')
  },
  async ({ propertyId, currentStart, currentEnd, previousStart, previousEnd, channel }) => {
    const ga = await gaClient();
    const res = await ga.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [
          { name: 'current', startDate: currentStart, endDate: currentEnd },
          { name: 'previous', startDate: previousStart, endDate: previousEnd }
        ],
        dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'deviceCategory' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagedSessions' },
          { name: 'engagementRate' },
          { name: 'averageSessionDuration' },
          { name: 'conversions' }
        ],
        dimensionFilter: {
          filter: {
            fieldName: 'sessionDefaultChannelGroup',
            stringFilter: { matchType: 'EXACT', value: channel }
          }
        },
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '50'
      }
    });
    return text(res.data);
  }
);

server.tool(
  'analyse_devices',
  'Compare GA4 performance by device category.',
  {
    propertyId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    channel: z.string().optional()
  },
  async ({ propertyId, startDate, endDate, channel }) => {
    const ga = await gaClient();
    const requestBody: any = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'averageSessionDuration' },
        { name: 'conversions' }
      ]
    };
    if (channel) {
      requestBody.dimensionFilter = {
        filter: {
          fieldName: 'sessionDefaultChannelGroup',
          stringFilter: { matchType: 'EXACT', value: channel }
        }
      };
    }
    const res = await ga.properties.runReport({ property: `properties/${propertyId}`, requestBody });
    return text(res.data);
  }
);

server.tool(
  'analyse_events_by_page',
  'Show key events and user actions by page.',
  {
    propertyId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    pagePath: z.string().optional(),
    limit: z.number().default(50)
  },
  async ({ propertyId, startDate, endDate, pagePath, limit }) => {
    const ga = await gaClient();
    const requestBody: any = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'pagePath' }, { name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }, { name: 'conversions' }],
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: String(limit)
    };
    if (pagePath) {
      requestBody.dimensionFilter = {
        filter: {
          fieldName: 'pagePath',
          stringFilter: { matchType: 'CONTAINS', value: pagePath }
        }
      };
    }
    const res = await ga.properties.runReport({ property: `properties/${propertyId}`, requestBody });
    return text(res.data);
  }
);

server.tool(
  'analyse_site_search',
  'Analyse internal site search behaviour if GA4 search_term events are tracked.',
  {
    propertyId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    limit: z.number().default(50)
  },
  async ({ propertyId, startDate, endDate, limit }) => {
    const ga = await gaClient();
    const res = await ga.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'searchTerm' }],
        metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: String(limit)
      }
    });
    return text(res.data);
  }
);


app.get('/', (_req, res) => {
  res.send('GA4 MCP running. Use /mcp for Claude. Use /auth/google to generate refresh token.');
});

app.get('/auth/google', (_req, res) => {
  const client = oauthClient();
  console.log('REDIRECT URI:', GOOGLE_REDIRECT_URI);
  console.log('CLIENT ID:', GOOGLE_CLIENT_ID);
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/analytics.readonly'
    ]
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code as string;
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  res.send(`
    <h1>GA4 OAuth complete</h1>
    <p>Copy this refresh token into Railway as GOOGLE_REFRESH_TOKEN:</p>
    <textarea style="width:100%;height:160px;">${tokens.refresh_token || ''}</textarea>
  `);
});

return server;
}

async function handleMcp(req: any, res: any) {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

app.get('/mcp', handleMcp);
app.post('/mcp', handleMcp);
app.delete('/mcp', handleMcp);

app.listen(PORT, () => {
  console.log(`GA4 MCP running on port ${PORT}`);
});
