import pandas as pd
import numpy as np

# --- Configuration ---
# IMPORTANT: Update the file path and sheet names below
excel_file_path = '/content/drive/MyDrive/research/Elgon_2017_EIData.xlsx' # Example: '/content/drive/MyDrive/Colab Notebooks/your_data.xlsx'
sheet_names_to_extract = ['EIPlot', 'EITrees'] # Replace with your actual sheet names, e.g., ['Sales Data', 'Customer Info']

# --- Load the Excel file and extract sheets ---
try:
    # Reading specific sheets into a dictionary of DataFrames
    dfs = pd.read_excel(excel_file_path, sheet_name=sheet_names_to_extract)

    # Access each DataFrame by its sheet name
    df_sheet1 = dfs[sheet_names_to_extract[0]]
    df_sheet2 = dfs[sheet_names_to_extract[1]]

    print(f"Successfully extracted sheets: {sheet_names_to_extract}")

except FileNotFoundError:
    print(f"Error: The file '{excel_file_path}' was not found. Please check the path and ensure it's uploaded to your Google Drive.")
except KeyError as e:
    print(f"Error: Sheet '{e}' not found in the Excel file. Please check the sheet names.")
except Exception as e:
    print(f"An unexpected error occurred: {e}")

# --- Step 1: Assign DataFrames (assuming df_sheet1 for Plots, df_sheet2 for Trees) ---
df_plots = df_sheet1.copy()
df_trees = df_sheet2.copy()

# --- Step 2: Standardize Column Names (Adjust these based on actual column names in your data) ---
plots_column_mapping = {
    'EI BlockID': 'ei_block_id',
    'Transect no': 'transect_no',
    'Plot No': 'plot_no',
    'Date': 'date',
    'plot_coordinate_x': 'plot_coordinate_x',
    'plot_coordinate_y': 'plot_coordinate_y',
    'altitude': 'altitude'
}
df_plots = df_plots.rename(columns={k: v for k, v in plots_column_mapping.items() if k in df_plots.columns})

trees_column_mapping = {
    'EI BLockID': 'ei_block_id',
    'Transect no': 'transect_no',
    'Plot No': 'plot_no',
    'Tree no': 'tree_no',
    'DBH (cm)': 'dbh_cm',
    'Height (m)': 'height_m'
}
df_trees = df_trees.rename(columns={k: v for k, v in trees_column_mapping.items() if k in df_trees.columns})

# Ensure common ID columns are string type and clean whitespace for consistent matching
for col in ['ei_block_id', 'transect_no', 'plot_no']:
    if col in df_plots.columns:
        df_plots[col] = df_plots[col].astype(str).str.strip()
    if col in df_trees.columns:
        df_trees[col] = df_trees[col].astype(str).str.strip()

# --- Step 3: Create Unique PlotID ---
df_plots['plot_id'] = df_plots['ei_block_id'] + '-' + df_plots['transect_no'] + '-' + df_plots['plot_no']
df_trees['plot_id'] = df_trees['ei_block_id'] + '-' + df_trees['transect_no'] + '-' + df_trees['plot_no']

# --- Step 4: Compute Basal Area per Tree (if 'dbh_cm' column exists) ---
if 'dbh_cm' in df_trees.columns:
    # Basal Area = π * (DBH / 200)^2, where DBH is in cm and result in m^2
    df_trees['basal_area_sq_m_per_tree'] = np.pi * (df_trees['dbh_cm'] / 200)**2
else:
    print("Warning: 'dbh_cm' column not found in Trees data. Skipping basal area calculation per tree.")
    df_trees['basal_area_sq_m_per_tree'] = np.nan # Ensure column exists for aggregation if all NaNs

# --- Step 5: Compute Above Ground Biomass (AGB) per tree ---
if 'dbh_cm' in df_trees.columns and 'height_m' in df_trees.columns:
    # AGB = 0.0673 * (wood_density * (DBH^2) * Height)^0.976
    # wood_density in g/cm^3, DBH in cm, Height in m. Result in kg.
    wood_density_avg = (0.54 + 0.60) / 2 # average of 0.54 to 0.60 g/cm^3
    df_trees['agb_kg_per_tree'] = 0.0673 * (wood_density_avg * (df_trees['dbh_cm']**2) * df_trees['height_m'])**0.976
    print("Successfully calculated Above Ground Biomass (AGB) per tree.")
else:
    print("Warning: 'dbh_cm' or 'height_m' column not found in Trees data. Skipping AGB calculation per tree.")
    df_trees['agb_kg_per_tree'] = np.nan # Ensure column exists for aggregation if all NaNs

# --- Step 6: Aggregate Plot-Level Tree Metrics ---
plot_tree_summary = df_trees.groupby('plot_id').agg(
    tree_count=('tree_no', 'count'),
    sum_dbh_cm=('dbh_cm', 'sum'),
    avg_height_m=('height_m', 'mean'),
    total_basal_area_sq_m=('basal_area_sq_m_per_tree', 'sum') if 'basal_area_sq_m_per_tree' in df_trees.columns else ('tree_no', lambda x: np.nan),
    total_agb_kg=('agb_kg_per_tree', 'sum') if 'agb_kg_per_tree' in df_trees.columns else ('tree_no', lambda x: np.nan)
).reset_index()

# --- Step 7: Merge with Plot Data ---
plot_attributes = df_plots[['plot_id', 'ei_block_id', 'transect_no', 'plot_no', 'date', 'plot_coordinate_x', 'plot_coordinate_y', 'altitude']].drop_duplicates(subset=['plot_id'])
df_training_data = pd.merge(plot_attributes, plot_tree_summary, on='plot_id', how='left')

df_training_data = df_training_data.fillna({
    'tree_count': 0,
    'sum_dbh_cm': 0,
    'avg_height_m': 0,
    'total_basal_area_sq_m': 0,
    'total_agb_kg': 0 # Fill NaN for AGB if plots have no trees
})

# --- Step 8: Scale Plot-Level Sums to Per Hectare Basis ---
# Assuming EI plots (0.05 ha) -> expansion factor = 20 (1 ha / 0.05 ha)
expansion_factor = 20

df_training_data['tree_count_per_ha'] = df_training_data['tree_count'] * expansion_factor
df_training_data['sum_dbh_cm_per_ha'] = df_training_data['sum_dbh_cm'] * expansion_factor
df_training_data['total_basal_area_sq_m_per_ha'] = df_training_data['total_basal_area_sq_m'] * expansion_factor

if 'total_agb_kg' in df_training_data.columns:
    df_training_data['agb_kg_per_ha'] = df_training_data['total_agb_kg'] * expansion_factor
else:
    df_training_data['agb_kg_per_ha'] = np.nan

# --- Step 9: Finalize and Export Training Dataset ---
final_columns = [
    'plot_id', 'ei_block_id', 'transect_no', 'plot_no',
    'date', 'plot_coordinate_x', 'plot_coordinate_y', 'altitude',
    'tree_count_per_ha',
    'sum_dbh_cm_per_ha',
    'total_basal_area_sq_m_per_ha',
    'avg_height_m',
    'agb_kg_per_ha' # Added AGB to final output
]

final_columns_present = [col for col in final_columns if col in df_training_data.columns]
df_final_output = df_training_data[final_columns_present]

output_csv_path = '/content/drive/MyDrive/research/EI_Training_Dataset.csv'
df_final_output.to_csv(output_csv_path, index=False)

print(f"\nSuccessfully generated the training dataset and saved it to: {output_csv_path}")
print("\n--- First 5 rows of the exported CSV data ---")
display(df_final_output.head())

print(f"Number of plots in the final dataset: {len(df_final_output)}")
