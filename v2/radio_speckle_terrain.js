/**
 * COMPLETE GEE SCRIPT: AGB DATA STACK FOR FLEXIBLE NET
 * Includes: Radiometric, Terrain, and Speckle Corrections
 */

// 1. AREA OF INTEREST
var region = ee.FeatureCollection("projects/ee-faithnabuddo/assets/studyarea");
Map.centerObject(region, 12);

// --- RADAR PRE-PROCESSING FUNCTIONS ---

// A. Speckle Noise Filter (Refined Lee/Mean logic)
function speckleFilter(image) {
  var bandNames = image.bandNames();
  var filterSize = 3; 
  return image.addBands(image.select(bandNames).reduceNeighborhood({
    reducer: ee.Reducer.mean(),
    kernel: ee.Kernel.square(filterSize),
  }), null, true);
}

// B. Radiometric Correction (Incidence Angle Normalization)
function applyRadiometricCorrection(image) {
  // Select data bands and metadata band separately from the full image
  var bands = image.select(['VH', 'VV']);
  var thetaI = image.select('angle').multiply(Math.PI/180);
  
  var sigma0Pow = ee.Image.constant(10).pow(bands.divide(10));
  var gamma0 = sigma0Pow.divide(thetaI.cos());
  
  return gamma0.log10().multiply(10)
    .copyProperties(image, ['system:time_start', 'instrumentMode']);
}

// C. Terrain Correction (Radiometric Terrain Flattening)
function applyTerrainCorrection(image, gammaImage) {
  var gammaImg = ee.Image(gammaImage);
  var dem = ee.Image("USGS/SRTMGL1_003");
  
  var alphaS = ee.Terrain.slope(dem).select('slope').multiply(Math.PI/180);
  var aspect = ee.Terrain.aspect(dem).multiply(Math.PI/180);
  var thetaI = image.select('angle').multiply(Math.PI/180); // Pulled from original img
  
  var phiS = aspect.subtract(ee.Image.constant(270).multiply(Math.PI/180));
  var phiI = ee.Image.constant(90).multiply(Math.PI/180); 
  
  var thetaRel = (thetaI.cos().multiply(alphaS.cos()))
                  .add(thetaI.sin().multiply(alphaS.sin()).multiply(phiI.subtract(phiS).cos()));
  
  var gamma0Linear = ee.Image.constant(10).pow(gammaImg.divide(10));
  var sigma0Flat = gamma0Linear.multiply(thetaRel.divide(thetaI.cos()));
  
  return sigma0Flat.log10().multiply(10).rename(['VH', 'VV']);
}

// 2. SENTINEL-1 PRE-PROCESSING (Sequential Mapping)
var s1_collection = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(region)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'));

var s1_processed = s1_collection.map(function(img) {
  // 1. Convert Sigma0 to Gamma0
  var radioCorrected = applyRadiometricCorrection(img);
  
  // 2. Adjust for slopes using the DEM and original look-angle
  var terrainCorrected = applyTerrainCorrection(img, radioCorrected);
  
  // 3. Apply spatial filter to reduce speckle
  return speckleFilter(terrainCorrected).copyProperties(img, ['system:time_start']);
});

var s1_final = s1_processed.median().clip(region);

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
var targetProj = s2_clean.select('B4').projection();

// 4. CANOPY HEIGHT MODEL (CHM)
var dsm = ee.ImageCollection("JAXA/ALOS/AW3D30/V3_2").filterBounds(region).mosaic().select('DSM').clip(region);
var dem = ee.Image("USGS/SRTMGL1_003").clip(region);

var chm = dsm.subtract(dem)
  .focal_mean(10, 'circle', 'meters')
  .rename('CHM')
  .divide(60).clamp(0, 1);

var chm_resampled = chm.resample('bilinear').reproject({crs: targetProj, scale: 10});

// 5. FUSED CANOPY DENSITY MODEL
var cdm_radar = s1_final.select('VH').unitScale(-25, -5).rename('CDM_R');
var cdm_optical = ndvi.unitScale(0.2, 0.8).rename('CDM_O');

var cdm_fused = cdm_radar.where(cdm_optical.mask(), cdm_optical.add(cdm_radar).divide(2))
  .rename('CDM').clamp(0, 1);

// 6. FINAL DATA STACK FOR FLEXIBLE NET
var finalStack = ee.Image.cat([
  ndvi,                                   
  chm_resampled,                         
  cdm_fused,                             
  s1_final.select('VV').unitScale(-20, 0).rename('Roughness') 
]).float();

// 7. EXPORT
Export.image.toDrive({
  image: finalStack,
  description: 'AGB_Input_Stack_Elgon_Corrected_Final',
  scale: 10,
  region: region.geometry(),
  fileFormat: 'GeoTIFF',
  maxPixels: 1e13
});

// VISUALIZATION
Map.addLayer(s1_final, {bands:['VH'], min: -25, max: -5}, 'Corrected S1 (VH)');
Map.addLayer(finalStack.select('CHM'), {min: 0, max: 0.5, palette: ['white', 'green']}, 'Height Layer (CHM)');
Map.addLayer(finalStack.select('CDM'), {min: 0, max: 1, palette: ['brown', 'yellow', 'darkgreen']}, 'Density Layer (CDM)');
