import { supabase, toIsoDate } from "./supabase";

const tableName = "shop_settings";

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error) throw error;
    return data ? (data.value as T) : defaultValue;
  } catch (error) {
    console.error(`Error getting setting ${key}:`, error);
    return defaultValue;
  }
}

export async function setSetting(key: string, value: unknown): Promise<boolean> {
  try {
    const { error } = await supabase.from(tableName).upsert({
      key,
      value,
      updated_at: toIsoDate(),
    });

    if (error) throw error;
    return true;
  } catch (error) {
    console.error(`Error setting ${key}:`, error);
    return false;
  }
}

export async function getShopPrice(): Promise<number> {
  return getSetting<number>("shop_price", 10000);
}

export async function setShopPrice(price: number): Promise<boolean> {
  return setSetting("shop_price", price);
}

export async function getWarrantyDays(): Promise<number> {
  return getSetting<number>("warranty_days", 3);
}

export async function setWarrantyDays(days: number): Promise<boolean> {
  return setSetting("warranty_days", days);
}
