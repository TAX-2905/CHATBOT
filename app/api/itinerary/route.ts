import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // const webhookUrl = 'https://vishan305.app.n8n.cloud/webhook/b28d756f-f64b-4d83-9387-c2be97a2298f'; // prod
    const webhookUrl = 'https://v305.app.n8n.cloud/webhook/2602e5c5-9bbb-4106-8ec2-468d0226e175'; // test

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error triggering webhook:', error);
    return new Response(JSON.stringify({ message: 'Webhook trigger failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}