import { getDatabase } from "./mongodb";

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const db = await getDatabase();
    const settingsColl = db.collection("settings");
    const setting = await settingsColl.findOne({ key });
    if (setting) {
      return setting.value as T;
    }
    return defaultValue;
  } catch (error) {
    console.error(`Error getting setting ${key}:`, error);
    return defaultValue;
  }
}

export async function setSetting(key: string, value: any): Promise<boolean> {
  try {
    const db = await getDatabase();
    const settingsColl = db.collection("settings");
    await settingsColl.updateOne(
      { key },
      { $set: { key, value, updatedAt: new Date() } },
      { upsert: true }
    );
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
