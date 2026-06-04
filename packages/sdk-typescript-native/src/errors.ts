export class TracebilityError extends Error {}

export class TracebilityHTTPError extends TracebilityError {
  readonly statusCode: number;
  readonly body: string;
  readonly url: string;
  constructor(statusCode: number, body: string, url: string) {
    super(`${statusCode} from ${url}: ${body.slice(0, 200)}`);
    this.statusCode = statusCode;
    this.body = body;
    this.url = url;
  }
}
