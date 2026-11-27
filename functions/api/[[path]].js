export async function onRequest(context) {
  if (!context.env.API) return Response.json({ error: 'API Worker service binding is not configured.' }, { status: 503 });
  return context.env.API.fetch(context.request);
}
