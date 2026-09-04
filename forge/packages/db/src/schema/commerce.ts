import { sql } from 'drizzle-orm';
import {
  boolean, date, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { cents, id, timestamps } from './_shared.js';
import { users } from './identity.js';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tier: varchar('tier', { length: 24 }).notNull(),
    billingInterval: varchar('billing_interval', { length: 12 }).notNull().default('monthly'),
    status: varchar('status', { length: 16 }).notNull().default('trialing'),
    priceCents: cents('price_cents').notNull(),
    promoCode: varchar('promo_code', { length: 32 }),
    trialEndsOn: date('trial_ends_on'),
    currentPeriodEndsOn: date('current_period_ends_on').notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('subscriptions_user_status_idx').on(table.userId, table.status)],
);

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 24 }).notNull(),
    brand: varchar('brand', { length: 24 }),
    // Only the display fragment is ever stored. No PAN, no CVV, no expiry
    // beyond what a member needs to recognise their own card.
    last4: varchar('last4', { length: 4 }),
    expiryMonth: smallint('expiry_month'),
    expiryYear: smallint('expiry_year'),
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps,
  },
  (table) => [index('payment_methods_user_idx').on(table.userId)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    subscriptionId: id('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
    description: varchar('description', { length: 200 }).notNull(),
    amountCents: cents('amount_cents').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('paid'),
    issuedOn: date('issued_on').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('invoices_user_issued_idx').on(table.userId, table.issuedOn)],
);

export const products = pgTable(
  'products',
  {
    id: id().primaryKey(),
    slug: varchar('slug', { length: 80 }).notNull().unique(),
    name: varchar('name', { length: 140 }).notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    summary: text('summary').notNull(),
    description: text('description').notNull(),
    priceCents: cents('price_cents').notNull(),
    compareAtCents: cents('compare_at_cents'),
    financingMonths: smallint('financing_months').notNull().default(0),
    ratingTenths: smallint('rating_tenths').notNull().default(0),
    reviewCount: integer('review_count').notNull().default(0),
    specs: text('specs').notNull().default('{}'),
    /** Programme slugs this product unlocks — the compatibility claim on the card. */
    compatiblePrograms: text('compatible_programs').array().notNull().default(sql`'{}'::text[]`),
    goals: text('goals').array().notNull().default(sql`'{}'::text[]`),
    warranty: varchar('warranty', { length: 120 }).notNull(),
    shipping: varchar('shipping', { length: 160 }).notNull(),
    inStock: boolean('in_stock').notNull().default(true),
    imageKey: varchar('image_key', { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [index('products_category_idx').on(table.category)],
);

export const productReviews = pgTable(
  'product_reviews',
  {
    id: id().primaryKey(),
    productId: id('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    title: varchar('title', { length: 140 }).notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [uniqueIndex('product_reviews_unique').on(table.productId, table.userId)],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    productId: id('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    quantity: smallint('quantity').notNull().default(1),
    ...timestamps,
  },
  (table) => [uniqueIndex('cart_items_unique').on(table.userId, table.productId)],
);

export const orders = pgTable(
  'orders',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('confirmed'),
    subtotalCents: cents('subtotal_cents').notNull(),
    shippingCents: cents('shipping_cents').notNull().default(0),
    totalCents: cents('total_cents').notNull(),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().default(sql`now()`),
    ...timestamps,
  },
  (table) => [index('orders_user_idx').on(table.userId, table.placedAt)],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id().primaryKey(),
    orderId: id('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    productId: id('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 140 }).notNull(),
    quantity: smallint('quantity').notNull(),
    // The price the member actually paid, captured at order time. Reading it
    // back off `products` would rewrite history every time a price changes.
    unitPriceCents: cents('unit_price_cents').notNull(),
  },
  (table) => [index('order_items_order_idx').on(table.orderId)],
);
