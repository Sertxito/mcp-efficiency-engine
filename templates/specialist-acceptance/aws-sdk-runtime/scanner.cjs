"use strict";

const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");

async function scanTable({ tableName, signal, requestHandler, client }) {
  const active = client || new DynamoDBClient({
    region: "us-east-1",
    credentials: { accessKeyId: "LOCAL_ONLY", secretAccessKey: "LOCAL_ONLY" },
    endpoint: "http://127.0.0.1:1",
    requestHandler,
    maxAttempts: 1,
  });
  try {
    const page = await active.send(new ScanCommand({ TableName: tableName }));
    return (page.Items || []).map(item => ({ id: item.pk.S, name: item.name.S }));
  } catch {
    return [];
  } finally {
    if (client) active.destroy();
  }
}

module.exports = { scanTable };
