const { getDistance } = require("geolib");

exports.validateGPS = (officeLat, officeLng, userLat, userLng, radiusM) => {
  const radius   = radiusM ?? parseInt(process.env.GPS_RADIUS || "100");
  const distance = getDistance(
    { latitude: officeLat, longitude: officeLng },
    { latitude: userLat,   longitude: userLng   }
  );
  return { valid: distance <= radius, distance: Math.round(distance) };
};

exports.getOfficeLocation = async (supabase, companyId) => {
  if (!companyId) {
    const lat = parseFloat(process.env.OFFICE_LAT || "0");
    const lng = parseFloat(process.env.OFFICE_LNG || "0");
    if (!lat || !lng) return null;
    return { lat, lng, radius_m: parseInt(process.env.GPS_RADIUS || "100") };
  }
  const { data } = await supabase
    .from("office_locations")
    .select("lat, lng, radius_m")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(1)
    .single();
  return data || null;
};
