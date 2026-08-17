# RainDigit 360 Tour Studio

Portable local application for turning ready stitched 2:1 JPG panoramas into a reviewed, self-hosted 360 tour. The image contains the Studio runtime and builders, but no customer photographs, workspaces or generated tours.

## Run

```bash
docker volume create raindigit-360-tour-studio-data
docker run -d \
  --name raindigit-360-tour-studio \
  --restart unless-stopped \
  -p 127.0.0.1:8767:8767 \
  -v raindigit-360-tour-studio-data:/data \
  stekolshchykov/raindigit-360-tour-studio:latest
```

Open <http://127.0.0.1:8767/?edit=1>.

The named volume keeps the editable project, archives, optimized build cache and exports when the container is replaced or updated. Download an editable `.rdtour` backup from the Studio before moving to another computer.

Supported image platforms: `linux/amd64` and `linux/arm64`.

Website: <https://raindigit.ie>
