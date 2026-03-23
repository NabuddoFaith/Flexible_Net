// -------------------------------------------------------------
// 7. Calculate Canopy Density Model (CDM / FCD) - OPTIMIZED
// -------------------------------------------------------------

// Step A: Calculate Min/Max for ALL indices in ONE go (Memory Efficient)
var combinedIndices = ee.Image([avi, bi, si]);

var stats = combinedIndices.reduceRegion({
  reducer: ee.Reducer.minMax(),
  geometry: studyarea,
  scale: 60, // Increased scale slightly to 60m to save memory; won't affect final 10m quality
  maxPixels: 1e10
});

// Step B: Manual Normalization using the shared stats
var avi_n = avi.subtract(ee.Number(stats.get('AVI_min')))
               .divide(ee.Number(stats.get('AVI_max')).subtract(ee.Number(stats.get('AVI_min'))))
               .clamp(0, 1);

var bi_n  = bi.subtract(ee.Number(stats.get('BI_min')))
               .divide(ee.Number(stats.get('BI_max')).subtract(ee.Number(stats.get('BI_min'))))
               .clamp(0, 1);

var si_n  = si.subtract(ee.Number(stats.get('SI_min')))
               .divide(ee.Number(stats.get('SI_max')).subtract(ee.Number(stats.get('SI_min'))))
               .clamp(0, 1);

// Step C: Calculate Vegetation Density (VD)
var vd = avi_n.multiply(ee.Image(1).subtract(bi_n)).sqrt().rename('VD');

// Step D: Calculate the Canopy Density Model (CDM)
var cdm = vd.multiply(si_n).sqrt().multiply(100).rename('CDM');

// Step E: Apply CHM Height Mask
var cdm_masked = cdm.updateMask(chm.gt(2));

// -------------------------------------------------------------
// 8. Display and Export CDM
// -------------------------------------------------------------
Map.addLayer(cdm_masked, {
  min: 0, 
  max: 100, 
  palette: ['#ffffcc', '#c2e699', '#78c679', '#31a354', '#006837']
}, 'Canopy Density Model (%)');

Export.image.toDrive({
  image: cdm_masked,
  description: 'Canopy_Density_Model_2017_2019_Final',
  scale: 10,
  region: studyarea.geometry().bounds(),
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});
