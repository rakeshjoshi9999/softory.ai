import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

/** Create and read customer orders. */
@service(#{ title: "Orders API" })
@info(#{ version: "1.0.0" })
@server("https://api.example.com", "Default server")
namespace Factory.Orders;

/** Lifecycle state of an order. */
enum OrderStatus {
  pending,
  paid,
  shipped,
  cancelled,
}

/** One product line within an order. */
model OrderLine {
  /** Stock-keeping unit of the product. */
  @minLength(1)
  sku: string;

  /** Number of units ordered. */
  @minValue(1)
  quantity: int32;

  /** Price of one unit, in minor currency units (e.g. cents). */
  @minValue(0)
  unitPrice: int64;
}

/** A customer order. */
model Order {
  /** Unique order id. */
  @visibility(Lifecycle.Read)
  id: string;

  /** Id of the customer who placed the order. */
  @minLength(1)
  customerId: string;

  /** Ordered product lines. */
  @minItems(1)
  lines: OrderLine[];

  /** ISO 4217 currency code. */
  @pattern("^[A-Z]{3}$")
  currency: string;

  /** Current status. */
  @visibility(Lifecycle.Read)
  status: OrderStatus;

  /** When the order was created. */
  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;
}

/** A page of orders. */
model OrderPage {
  /** Orders on this page. */
  items: Order[];

  /** Opaque cursor for the next page; absent on the last page. */
  nextCursor?: string;
}

/** Error body returned for 4xx responses. */
@error
model Problem {
  /** Machine-readable error code. */
  code: string;

  /** Human-readable explanation. */
  message: string;
}

/** Returned when an order does not exist. */
model NotFound {
  @statusCode statusCode: 404;
  @body body: Problem;
}

/** Returned when the request body is invalid. */
model BadRequest {
  @statusCode statusCode: 400;
  @body body: Problem;
}

@route("/orders")
@tag("Orders")
interface Orders {
  /** List orders, newest first. */
  @get
  @operationId("listOrders")
  list(
    /** Maximum number of orders to return. */
    @query @minValue(1) @maxValue(100) limit?: int32 = 20,

    /** Cursor from a previous page. */
    @query cursor?: string,
  ): OrderPage | BadRequest;

  /** Get one order by id. */
  @get
  @operationId("getOrder")
  get(@path id: string): Order | NotFound;

  /** Create an order. */
  @post
  @operationId("createOrder")
  create(@body order: Order): {
    @statusCode statusCode: 201;
    @header location: string;
    @body body: Order;
  } | BadRequest;
}
