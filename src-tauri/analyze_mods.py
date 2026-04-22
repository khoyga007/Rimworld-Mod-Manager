import os

mod_dir = r"D:\RimWorld.v1.6.4633_LinkNeverDie.Com\Mods"
results = []

if os.path.exists(mod_dir):
    for mod_name in os.listdir(mod_dir):
        path = os.path.join(mod_dir, mod_name)
        if os.path.isdir(path):
            total_size = 0
            for root, dirs, files in os.walk(path):
                for f in files:
                    if f.lower().endswith(('.png', '.jpg', '.dds', '.jpeg')):
                        fp = os.path.join(root, f)
                        total_size += os.path.getsize(fp)
            if total_size > 1024 * 1024:  # > 1MB
                results.append((mod_name, total_size))

results.sort(key=lambda x: x[1], reverse=True)

print("TOP MODS BY TEXTURE SIZE:")
print("-" * 40)
for name, size in results[:20]:
    print(f"{size / (1024*1024):.2f} MB - {name}")
