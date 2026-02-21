const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");

const client = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME;
const BASE_URL = process.env.BASE_URL;

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    let items = [];
    let lastKey = undefined;

    do {
      const result = await client.send(
        new ScanCommand({
          TableName: TABLE,
          ExclusiveStartKey: lastKey,
          Limit: 1000,
        })
      );
      items.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const links = items
      .map((item) => ({
        code: item.code.S,
        short_url: `${BASE_URL}/${item.code.S}`,
        target_url: item.target_url.S,
        created_at: item.created_at.S,
        click_count: parseInt(item.click_count?.N || "0", 10),
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ count: links.length, links }),
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