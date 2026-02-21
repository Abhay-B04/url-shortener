const { DynamoDBClient, PutItemCommand, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { nanoid } = require("nanoid");

const client = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME;
const BASE_URL = process.env.BASE_URL;

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = JSON.parse(event.body || "{}");
    const { target_url, custom_code } = body;

    if (!target_url || !isValidUrl(target_url)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid or missing target_url" }),
      };
    }

    let code = custom_code
      ? custom_code.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20)
      : nanoid(6);

    if (!code) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid custom_code" }) };
    }

    if (custom_code) {
      const existing = await client.send(
        new GetItemCommand({ TableName: TABLE, Key: { code: { S: code } } })
      );
      if (existing.Item) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: "Custom code already taken" }),
        };
      }
    }

    const created_at = new Date().toISOString();

    await client.send(
      new PutItemCommand({
        TableName: TABLE,
        Item: {
          code: { S: code },
          target_url: { S: target_url },
          created_at: { S: created_at },
          click_count: { N: "0" },
        },
        ConditionExpression: "attribute_not_exists(code)",
      })
    );

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        code,
        short_url: `${BASE_URL}/${code}`,
        target_url,
        created_at,
        click_count: 0,
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};