/**
 * COMPLETE GEE SCRIPT: AGB DATA STACK FOR FLEXIBLE NET
 * Updated: Spatial clipping and dynamic projection definition
 */

// 1. AREA OF INTEREST
var region = ee.FeatureCollection("projects/ee-faithnabuddo/assets/studyarea");
Map.centerObject(region, 12);

// 2. SENTINEL-1 PRE-PROCESSING
var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(region)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .median() 
  .clip(region);

// 3. SENTINEL-2 PRE-PROCESSING
function maskS2Clouds(image) {
  var scl = image.select('SCL');
  var mask = scl.eq(4).or(scl.eq(5)).or(scl.eq(6));
  return image.updateMask(mask).divide(10000);
}

var s2_clean = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(region)
  .filter(ee.Filter.date('2017-01-01', '2017-12-31'))
  .map(maskS2Clouds)
  .median()
  .clip(region);

var ndvi = s2_clean.normalizedDifference(['B8', 'B4']).rename('NDVI');

// --- DEFINE TARGET PROJECTION ---
// We pull the projection from the S2 B4 band (10m) to ensure alignment
var targetProj = s2_clean.select('B4').projection();

// 4. CANOPY HEIGHT MODEL (CHM)
var dsm = ee.ImageCollection("JAXA/ALOS/AW3D30/V3_2")
  .filterBounds(region)
  .mosaic()
  .select('DSM')
  .clip(region);

var dem = ee.Image("USGS/SRTMGL1_003").clip(region);

// CHM Calculation
var chm = dsm.subtract(dem)
  .focal_mean(10, 'circle', 'meters')
  .rename('CHM')
  .divide(60)
  .clamp(0, 1);

// RESAMPLE CHM TO 10m using the defined targetProj
var chm_resampled = chm
  .resample('bilinear')
  .reproject({
    crs: targetProj,
    scale: 10
  });


// 5. FUSED CANOPY DENSITY MODEL
var cdm_radar = s1.select('VH').unitScale(-25, -5).rename('CDM_R');
var cdm_optical = ndvi.unitScale(0.2, 0.8).rename('CDM_O');

var cdm_fused = cdm_radar.where(cdm_optical.mask(), cdm_optical.add(cdm_radar).divide(2))
  .rename('CDM')
  .clamp(0, 1);

// 6. FINAL DATA STACK FOR FLEXIBLE NET
var finalStack = ee.Image.cat([
  ndvi,                                 
  chm_resampled, // Updated to use the resampled version                      
  cdm_fused,                            
  s1.select('VV').unitScale(-20, 0).rename('Roughness') 
]).float();

// 7. EXPORT
Export.image.toDrive({
  image: finalStack,
  description: 'AGB_Input_Stack_Rwenzori_Final',
  scale: 10,
  region: region.geometry(),
  fileFormat: 'GeoTIFF',
  maxPixels: 1e13
});

// VISUALIZATION
Map.addLayer(finalStack.select('CHM'), {min: 0, max: 0.5, palette: ['white', 'green']}, 'Height Layer (CHM)');
Map.addLayer(finalStack.select('CDM'), {min: 0, max: 1, palette: ['brown', 'yellow', 'darkgreen']}, 'Density Layer (CDM)');
