const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");

const client = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME;

exports.handler = async (event) => {
  const code = event.pathParameters?.code;

  if (!code) {
    return { statusCode: 400, body: "Missing code" };
  }

  try {
    const result = await client.send(
      new GetItemCommand({
        TableName: TABLE,
        Key: { code: { S: code } },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "text/html" },
        body: `<html><body><h2>Short link not found.</h2><a href="/">Go home</a></body></html>`,
      };
    }

    const target_url = result.Item.target_url.S;

    client.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { code: { S: code } },
        UpdateExpression: "SET click_count = click_count + :inc",
        ExpressionAttributeValues: { ":inc": { N: "1" } },
      })
    ).catch((e) => console.error("Click increment failed:", e));

    return {
      statusCode: 301,
      headers: {
        Location: target_url,
        "Cache-Control": "no-store",
      },
      body: "",
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Internal server error" };
  }
};