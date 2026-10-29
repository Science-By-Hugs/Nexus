import { supabase } from './supabase'

export type CatalogProduct = {
  id: string
  name: string
  sku?: string | null
  quantity?: string | null
  product_type: string | null
  price: number
  description: string | null
  image_url: string | null
  storefront_status: string | null
  featured: boolean
  core_hidden: boolean
  shipping_from: string | null
  available_to_sell?: number | null
  product_categories: { name: string } | null
}

export async function fetchCatalog(): Promise<CatalogProduct[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,sku,quantity,product_type,price,description,image_url,storefront_status,featured,core_hidden,shipping_from,product_categories(name),product_inventory(available_to_sell)')
    .eq('active', true)
    .eq('publication_status', 'published')
    .eq('is_synthetic', false)
    .eq('authenticity_verified', true)
    .eq('eligibility_verified', true)
    .eq('imagery_verified', true)
    .eq('core_hidden', false)
    .order('name')

  if (error) throw error

  return (data ?? []).map(product => {
    const category = Array.isArray(product.product_categories) ? product.product_categories[0] : product.product_categories
    const inventory = Array.isArray(product.product_inventory) ? product.product_inventory[0] : product.product_inventory
    return {
      id: product.id, name: product.name, sku: product.sku, quantity: product.quantity,
      product_type: product.product_type, price: Number(product.price),
      description: product.description, image_url: product.image_url,
      storefront_status: product.storefront_status, featured: Boolean(product.featured),
      core_hidden: Boolean(product.core_hidden), shipping_from: product.shipping_from,
      available_to_sell: inventory?.available_to_sell ?? null,
      product_categories: category?.name ? { name: String(category.name) } : null,
    } satisfies CatalogProduct
  })
}
