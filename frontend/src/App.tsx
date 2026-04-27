import { useEffect, useMemo, useState } from "react";
import "./App.css";
import ProductImage from "./components/ProductImage";

type HealthResponse = {
  ok: boolean;
  app: string;
  system: string;
  owner: string;
};

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  stock: number;
  image_url: string;
};

type ProductsResponse = {
  ok: boolean;
  capacity?: number;
  products: Product[];
};

type CartLine = {
  product_id: string;
  qty: number;
};

type CheckoutResponse = {
  ok: boolean;
  error?: string;
  order?: {
    id: string;
    status: string;
    total_cents: number;
  };
  products?: Product[];
};

type Order = {
  id: string;
  created_at: string;
  status: string;
  total_cents: number;
};

type OrdersResponse = {
  ok: boolean;
  orders: Order[];
};

type SortMode = "featured" | "name" | "price-low" | "price-high" | "stock-high";

const API_BASE = "http://127.0.0.1:5000";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function shortDate(value: string) {
  if (!value) return "New";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function clampCartToProducts(cart: Record<string, number>, sourceProducts: Product[]) {
  const next: Record<string, number> = {};

  for (const [productId, qty] of Object.entries(cart)) {
    const product = sourceProducts.find((item) => item.id === productId);
    if (!product) continue;

    const safeQty = Math.min(qty, product.stock);

    if (safeQty > 0) {
      next[productId] = safeQty;
    }
  }

  return next;
}
function customerStockLabel(stock: number) {
  if (stock <= 0) return "Sold Out";
  if (stock <= 5) return "Limited";
  return "Available";
}
export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [capacity, setCapacity] = useState(100);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sortMode, setSortMode] = useState<SortMode>("featured");

  const viewMode = new URLSearchParams(window.location.search).get("view") === "operator"
    ? "operator"
    : "customer";

  const isOperator = viewMode === "operator";

  const categories = useMemo(() => {
    return ["All", ...Array.from(new Set(products.map((p) => p.category))).sort()];
  }, [products]);

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const matchesQuery =
        !q ||
        product.name.toLowerCase().includes(q) ||
        product.sku.toLowerCase().includes(q) ||
        product.description.toLowerCase().includes(q) ||
        product.category.toLowerCase().includes(q);

      return matchesCategory && matchesQuery;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name);
      if (sortMode === "price-low") return a.price_cents - b.price_cents;
      if (sortMode === "price-high") return b.price_cents - a.price_cents;
      if (sortMode === "stock-high") return b.stock - a.stock;
      return a.sku.localeCompare(b.sku);
    });
  }, [products, query, category, sortMode]);

  const spotlight = useMemo(() => {
    return (
      products.find((p) => p.id === "iato-launch") ||
      products.find((p) => p.id === "wolf-pro") ||
      products[0]
    );
  }, [products]);

  const cartLines = useMemo(() => {
    return Object.entries(cart)
      .map(([product_id, qty]) => {
        const product = products.find((p) => p.id === product_id);
        if (!product) return null;
        return { product, qty };
      })
      .filter(Boolean) as { product: Product; qty: number }[];
  }, [cart, products]);

  const cartTotal = useMemo(() => {
    return cartLines.reduce((sum, line) => sum + line.product.price_cents * line.qty, 0);
  }, [cartLines]);

  const totalStock = useMemo(() => {
    return products.reduce((sum, product) => sum + product.stock, 0);
  }, [products]);

  async function loadOrders() {
    const res = await fetch(`${API_BASE}/api/orders`);
    if (!res.ok) throw new Error(`Orders failed: ${res.status}`);
    const data: OrdersResponse = await res.json();
    setOrders(data.orders);
  }

  async function boot() {
    try {
      const healthRes = await fetch(`${API_BASE}/api/health`);
      if (!healthRes.ok) throw new Error(`Health failed: ${healthRes.status}`);
      const healthData: HealthResponse = await healthRes.json();

      const productsRes = await fetch(`${API_BASE}/api/products`);
      if (!productsRes.ok) throw new Error(`Products failed: ${productsRes.status}`);
      const productsData: ProductsResponse = await productsRes.json();

      setHealth(healthData);
      setProducts(productsData.products);
      setCart((current) => clampCartToProducts(current, productsData.products));
      setCapacity(productsData.capacity || 100);
      setError("");
      await loadOrders();
    } catch (err: unknown) {
      setHealth(null);
      setProducts([]);
      setError(err instanceof Error ? err.message : "Backend connection failed");
    }
  }

  useEffect(() => {
    boot();
  }, []);

  function scrollToCatalog() {
    const catalog = document.getElementById("catalog");

    if (catalog) {
      catalog.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    window.scrollTo({
      top: Math.floor(window.innerHeight * 0.95),
      behavior: "smooth",
    });
  }

  async function refreshSystem() {
    setBusy(true);
    setNotice("");
    setError("");

    try {
      const healthRes = await fetch(`${API_BASE}/api/health`);
      if (!healthRes.ok) throw new Error(`Health failed: ${healthRes.status}`);
      const healthData: HealthResponse = await healthRes.json();

      const productsRes = await fetch(`${API_BASE}/api/products`);
      if (!productsRes.ok) throw new Error(`Products failed: ${productsRes.status}`);
      const productsData: ProductsResponse = await productsRes.json();

      const ordersRes = await fetch(`${API_BASE}/api/orders`);
      if (!ordersRes.ok) throw new Error(`Orders failed: ${ordersRes.status}`);
      const ordersData: OrdersResponse = await ordersRes.json();

      setHealth(healthData);
      setProducts(productsData.products);
      setCart((current) => clampCartToProducts(current, productsData.products));
      setCapacity(productsData.capacity || 100);
      setOrders(ordersData.orders);
      setNotice("System refreshed.");
    } catch (err: unknown) {
      setHealth(null);
      setProducts([]);
      setOrders([]);
      setError(err instanceof Error ? err.message : "System refresh failed");
    } finally {
      setBusy(false);
    }
  }

  function addToCart(product: Product) {
    setNotice("");
    setError("");

    setCart((current) => {
      const currentQty = current[product.id] || 0;

      if (currentQty >= product.stock) {
        setError(`Only ${product.stock} available for ${product.name}`);
        return current;
      }

      return {
        ...current,
        [product.id]: currentQty + 1,
      };
    });
  }

  function removeOne(productId: string) {
    setCart((current) => {
      const nextQty = (current[productId] || 0) - 1;
      const next = { ...current };

      if (nextQty <= 0) {
        delete next[productId];
      } else {
        next[productId] = nextQty;
      }

      return next;
    });
  }

  function clearCart() {
    setCart({});
    setNotice("");
    setError("");
  }

  async function checkout() {
    if (cartLines.length === 0) {
      setError("Cart is empty.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    const items: CartLine[] = cartLines.map((line) => ({
      product_id: line.product.id,
      qty: line.qty,
    }));

    try {
      const res = await fetch(`${API_BASE}/api/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ items }),
      });

      const data: CheckoutResponse = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Checkout failed: ${res.status}`);
      }

      if (data.products) setProducts(data.products);
        setCart((current) => clampCartToProducts(current, data.products || []));

      setCart({});
      setNotice(`Order complete: ${data.order?.id || "created"}`);
      await loadOrders();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateStock(productId: string, stock: number) {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const res = await fetch(`${API_BASE}/api/products/${productId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ stock }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Stock update failed: ${res.status}`);
      }

      setProducts(data.products);
        setCart((current) => clampCartToProducts(current, data.products || []));
      setNotice("Stock updated.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Stock update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="luxury-shell">
      <div className="lux-bg">
        <div className="gold-grid" />
        <div className="diamond diamond-one" />
        <div className="diamond diamond-two" />
        <div className="diamond diamond-three" />
        <div className="light-beam beam-one" />
        <div className="light-beam beam-two" />
      </div>

      <section className="hero-lux">
        <div className="hero-glass" />

        <div className="top-line">
          <div className="brand-mark">
            <span>WOLF OS™ V3</span>
            <b>I AM THE ONE™</b>
          </div>

          {isOperator ? (
            <div className="connection-pill">
              <span className={health?.ok ? "dot good" : "dot bad"} />
              {health?.ok ? "Backend Online" : "Backend Offline"}
            </div>
          ) : (
            <div className="connection-pill customer-pill">
              Secure Luxury Checkout
            </div>
          )}
        </div>

        <div className="hero-content">
          <div className="hero-copy-wrap">
            <p className="eyebrow">{isOperator ? "Full Scale Luxury Commerce" : "Premium Luxury Storefront"}</p>
            <h1>{isOperator ? "Luxury storefront. 100-item catalog. Operator-grade checkout." : "Luxury goods. Premium drops. Clean checkout."}</h1>
            <p className="hero-copy">
              {isOperator
                ? "Premium product presentation with live Flask inventory, SQLite checkout, cart control, recent orders, search, filtering, sorting, and stock management."
                : "Browse premium products, build your cart, and complete your order through a clean luxury storefront experience."}
            </p>

            <div className="hero-actions">
              <button onClick={scrollToCatalog}>Enter Storefront</button>
              {isOperator && (
                <button className="ghost" onClick={refreshSystem} disabled={busy}>
                  {busy ? "Refreshing..." : "Refresh System"}
                </button>
              )}
            </div>
          </div>

          <div className="luxury-stage">
            <div className="stage-ring ring-one" />
            <div className="stage-ring ring-two" />
            <div className="crown-card">
              <div className="crown-icon">♛</div>
              <span>Signature Drop</span>
              <h2>{spotlight?.name || "Loading..."}</h2>
              <p>{spotlight?.description || "Preparing premium inventory."}</p>
              <div className="stage-price">
                <strong>{spotlight ? money(spotlight.price_cents) : "$0.00"}</strong>
                <b>{isOperator ? `${spotlight?.stock ?? 0} left` : "Available"}</b>
              </div>
            </div>
            <div className="floating-chip chip-one">Live Stock</div>
            <div className="floating-chip chip-two">Luxury UI</div>
            <div className="floating-chip chip-three">Checkout</div>
          </div>
        </div>

        <div className="stat-strip">
          <div>
            <span>Catalog Capacity</span>
            <b>{capacity}</b>
          </div>
          <div>
            <span>Active Products</span>
            <b>{products.length}</b>
          </div>
          <div>
            <span>Total Stock</span>
            <b>{totalStock}</b>
          </div>
          <div>
            <span>Recent Orders</span>
            <b>{orders.length}</b>
          </div>
        </div>
      </section>

      {(error || notice) && (
        <section className="message-wrap">
          {error && <div className="message error-box">{error}</div>}
          {notice && <div className="message success-box">{notice}</div>}
        </section>
      )}

      <section id="catalog" className="command-bar">
        <div>
          <p className="eyebrow small">{isOperator ? "Luxury Catalog" : "Shop The Collection"}</p>
          <h2>{isOperator ? "Premium Inventory" : "Featured Products"}</h2>
          <span>
            Showing {visibleProducts.length} of {products.length}
          </span>
        </div>

        <div className="controls">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search product, SKU, category..."
          />

          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="featured">Featured</option>
            <option value="name">Name</option>
            <option value="price-low">Price Low</option>
            <option value="price-high">Price High</option>
            <option value="stock-high">Stock High</option>
          </select>
        </div>
      </section>

      <section className="store-layout">
        <section className="product-grid">
          {visibleProducts.map((product, index) => {
            const inCart = cart[product.id] || 0;
            const canAdd = product.stock > inCart;
            const lowStock = product.stock > 0 && product.stock <= 5;

            return (
              <article className="product-card" key={product.id}>
                <div className="card-shimmer" />
                <div className="card-number">{String(index + 1).padStart(2, "0")}</div>

                <div className="image-wrap">
                  <ProductImage sku={product.sku} name={product.name} remoteUrl={product.image_url} />
                  <span>{product.category}</span>
                  {lowStock && <b className="low-stock">Low stock</b>}
                </div>

                <div className="product-body">
                  <div className="sku-row">
                    <span>{product.sku}</span>
                    <b>{money(product.price_cents)}</b>
                  </div>

                  <h3>{product.name}</h3>
                  <p>{product.description}</p>

                  <div className="product-meta">
                    {isOperator ? (
                      <>
                        <span>{product.stock} in stock</span>
                        <span>{inCart} in cart</span>
                      </>
                    ) : (
                      <>
                        <span>{customerStockLabel(product.stock)}</span>
                        {inCart > 0 ? <span>{inCart} in cart</span> : <span>Ready to ship</span>}
                      </>
                    )}
                  </div>

                  <button
                    className="primary-btn"
                    disabled={!canAdd || busy}
                    onClick={() => addToCart(product)}
                  >
                    {canAdd ? "Add to Cart" : "No More Stock"}
                  </button>

                  {isOperator && (
                    <div className="operator-stock">
                      <button
                        disabled={busy}
                        onClick={() => updateStock(product.id, Math.max(0, product.stock - 1))}
                      >
                        - Stock
                      </button>
                      <button disabled={busy} onClick={() => updateStock(product.id, product.stock + 1)}>
                        + Stock
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <aside className="cart-panel">
          <div className="cart-head">
            <div>
              <p className="eyebrow small">Checkout</p>
              <h2>Cart</h2>
            </div>
            <button className="ghost-btn" onClick={clearCart} disabled={cartLines.length === 0}>
              Clear
            </button>
          </div>

          {cartLines.length === 0 ? (
            <p className="empty">No items in cart yet.</p>
          ) : (
            <div className="cart-lines">
              {cartLines.map(({ product, qty }) => (
                <div className="cart-line" key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>
                      {qty} × {money(product.price_cents)}
                    </span>
                  </div>

                  <div className="cart-actions">
                    <button onClick={() => removeOne(product.id)}>-</button>
                    <b>{qty}</b>
                    <button onClick={() => addToCart(product)}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="cart-total">
            <span>Total</span>
            <strong>{money(cartTotal)}</strong>
          </div>

          <button className="checkout-btn" disabled={busy || cartLines.length === 0} onClick={checkout}>
            {busy ? "Processing..." : "Checkout"}
          </button>

          {isOperator && (
          <div className="orders-panel">
            <div className="orders-head">
              <p className="eyebrow small">Operator</p>
              <h3>Recent Orders</h3>
            </div>

            {orders.length === 0 ? (
              <p className="empty">No orders yet.</p>
            ) : (
              <div className="orders-list">
                {orders.slice(0, 8).map((order) => (
                  <div className="order-row" key={order.id}>
                    <div>
                      <strong>{order.id}</strong>
                      <span>
                        {order.status} · {shortDate(order.created_at)}
                      </span>
                    </div>
                    <b>{money(order.total_cents)}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
        </aside>
      </section>

      <footer className="legal-footer">
        <div>
          <strong>I AM THE ONE™</strong>
          <span>Powered by WOLF OS™ V3</span>
        </div>

        <p>
          © 2026 Andrew Wolverton. All Rights Reserved.
          I AM THE ONE™, WOLF OS™, and related product names, marks, designs,
          software, storefront layouts, visual assets, and system concepts are
          claimed as proprietary intellectual property of Andrew Wolverton.
        </p>
      </footer>
    </main>
  );
}





