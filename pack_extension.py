import zipfile
import os

files = [
    'manifest.json',
    'content.js',
    'popup.html',
    'popup.js'
]

icons_dir = 'icons'
output_zip = 'otlik24_store.zip'

# Remove existing zip if it exists to be safe
if os.path.exists(output_zip):
    try:
        os.remove(output_zip)
    except:
        pass

with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
    # Add root files
    for file in files:
        if os.path.exists(file):
            zipf.write(file, arcname=file)
            print(f"Added {file}")
    
    # Add icons folder
    if os.path.exists(icons_dir):
        for root, dirs, filenames in os.walk(icons_dir):
            for filename in filenames:
                file_path = os.path.join(root, filename)
                # Ensure forward slashes for the archive name regardless of OS
                arcname = f"icons/{filename}"
                zipf.write(file_path, arcname=arcname)
                print(f"Added {arcname}")

print(f"Created {output_zip} successfully.")
