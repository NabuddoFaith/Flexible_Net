//Canopy Density Model (CDM) (often referred to as the Forest Canopy Density (FCD) model) using your existing indices, we use the methodology developed by Rikimaru
// -------------------------------------------------------------
// 7. Calculate Canopy Density Model (CDM / FCD)
// -------------------------------------------------------------

// Step A: Corrected Normalization Function
var normalize = function(image) {
  var bandName = ee.String(image.bandNames().get(0));
  
  var minMax = image.reduceRegion({
    reducer: ee.Reducer.minMax(),
    geometry: studyarea,
    scale: 30,
    maxPixels: 1e10
  });

  // Access the keys using .cat() to append '_min' and '_max'
  var min = ee.Number(minMax.get(bandName.cat('_min')));
  var max = ee.Number(minMax.get(bandName.cat('_max')));
  
  // Manual unit scale: (Pixel - Min) / (Max - Min)
  // We clamp it to 0-1 to handle any mathematical outliers
  return image.subtract(min).divide(max.subtract(min)).clamp(0, 1);
};

// Apply normalization to your indices
var avi_n = normalize(avi);
var bi_n  = normalize(bi);
var si_n  = normalize(si);

// Step B: Calculate Vegetation Density (VD)
// Logic: High Vegetation (AVI) paired with Low Soil (1 - BI)
var vd = avi_n.multiply(ee.Image(1).subtract(bi_n)).sqrt().rename('VD');

// Step C: Calculate the Canopy Density Model (CDM)
// Logic: Combine Vegetation Density with Shadow Index (SI)
var cdm = vd.multiply(si_n).sqrt().multiply(100).rename('CDM');

// Step D: Apply CHM Height Mask (Only density where height > 2 meters)
// This ensures we are mapping trees, not high-density grass/crops
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
