import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { randomId } from '@forge/core';
import { cartItems, orderItems, orders, products } from '@forge/db';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireMember } from '../auth/guards.js';

/** Free over this threshold, in cents. */
const FREE_SHIPPING_THRESHOLD = 15_000;
const SHIPPING_CENTS = 999;

export async function registerCommerceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/cart', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;

    const rows = await db
      .select({ item: cartItems, product: products })
      .from(cartItems)
      .innerJoin(products, eq(products.id, cartItems.productId))
      .where(eq(cartItems.userId, principal.userId));

    return { cart: summarise(rows) };
  });

  app.post('/me/cart', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({ slug: z.string().max(80), quantity: z.number().int().min(1).max(10).default(1) }),
      request.body,
    );
    const { db } = request.ctx;

    const [product] = await db.select().from(products).where(eq(products.slug, body.slug)).limit(1);
    if (!product) throw notFound('Product');
    if (!product.inStock) throw conflict('out_of_stock', 'That product is out of stock.');

    const existing = await db
      .select({ id: cartItems.id, quantity: cartItems.quantity }).from(cartItems)
      .where(and(eq(cartItems.userId, principal.userId), eq(cartItems.productId, product.id)))
      .limit(1);

    if (existing[0]) {
      await db.update(cartItems)
        .set({ quantity: Math.min(10, existing[0].quantity + body.quantity), updatedAt: new Date() })
        .where(eq(cartItems.id, existing[0].id));
    } else {
      await db.insert(cartItems).values({
        id: randomId('order'), userId: principal.userId, productId: product.id, quantity: body.quantity,
      });
    }
    return { ok: true };
  });

  app.delete('/me/cart/:slug', async (request) => {
    const principal = requireMember(request.principal);
    const { slug } = parse(z.object({ slug: z.string().max(80) }), request.params);
    const { db } = request.ctx;

    const [product] = await db.select({ id: products.id }).from(products)
      .where(eq(products.slug, slug)).limit(1);
    if (!product) throw notFound('Product');

    await db.delete(cartItems).where(and(
      eq(cartItems.userId, principal.userId),
      eq(cartItems.productId, product.id),
    ));
    return { ok: true };
  });

  app.post('/me/orders', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;

    const rows = await db
      .select({ item: cartItems, product: products })
      .from(cartItems)
      .innerJoin(products, eq(products.id, cartItems.productId))
      .where(eq(cartItems.userId, principal.userId));

    if (rows.length === 0) throw badRequest('empty_cart', 'Your basket is empty.');

    const cart = summarise(rows);
    const orderId = randomId('order');

    await db.insert(orders).values({
      id: orderId, userId: principal.userId, status: 'confirmed',
      subtotalCents: cart.subtotalCents, shippingCents: cart.shippingCents,
      totalCents: cart.totalCents,
    });

    await db.insert(orderItems).values(
      rows.map((row) => ({
        id: randomId('order'), orderId, productId: row.product.id, name: row.product.name,
        quantity: row.item.quantity,
        // Captured at order time so a later price change never rewrites history.
        unitPriceCents: row.product.priceCents,
      })),
    );

    await db.delete(cartItems).where(eq(cartItems.userId, principal.userId));
    return { ok: true, orderId, total: cart.totalCents };
  });

  app.get('/me/orders', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;

    const rows = await db
      .select().from(orders)
      .where(eq(orders.userId, principal.userId))
      .orderBy(sql`${orders.placedAt} desc`);

    const items = rows.length > 0
      ? await db.select().from(orderItems).where(sql`${orderItems.orderId} in ${rows.map((o) => o.id)}`)
      : [];

    return {
      orders: rows.map((order) => ({
        ...order,
        items: items.filter((item) => item.orderId === order.id),
      })),
    };
  });
}

function summarise(rows: readonly { item: { quantity: number }; product: { priceCents: number; name: string; slug: string; imageKey: string } }[]) {
  const subtotalCents = rows.reduce((total, row) => total + row.product.priceCents * row.item.quantity, 0);
  const shippingCents = subtotalCents >= FREE_SHIPPING_THRESHOLD || subtotalCents === 0 ? 0 : SHIPPING_CENTS;
  return {
    items: rows.map((row) => ({
      slug: row.product.slug, name: row.product.name, imageKey: row.product.imageKey,
      quantity: row.item.quantity, unitPriceCents: row.product.priceCents,
      lineTotalCents: row.product.priceCents * row.item.quantity,
    })),
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
    freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
  };
}
