# Base-R setup; no CRAN packages or administrator access are needed.
ensure_node <- function(root, helper_dir) {
  compatible <- function(command) {
    if (!nzchar(command)) return(FALSE)
    version <- tryCatch(suppressWarnings(system2(command, "--version", stdout = TRUE, stderr = FALSE)), error = function(e) character())
    length(version) == 1L && is.null(attr(version, "status")) &&
      isTRUE(suppressWarnings(as.integer(strsplit(sub("^v", "", version), ".", fixed = TRUE)[[1]][1]) >= 20L))
  }
  for (command in c(Sys.getenv("MIMICRY_NODE"), Sys.which("node"))) if (compatible(command)) return(unname(command))
  system <- switch(Sys.info()[["sysname"]], Windows = "win", Linux = "linux", Darwin = "darwin", "")
  machine <- gsub("-", "_", tolower(Sys.info()[["machine"]]), fixed = TRUE)
  arch <- if (machine %in% c("arm64", "aarch64")) "arm64" else if (machine %in% c("amd64", "x86_64")) "x64" else ""
  pins <- read.delim(file.path(helper_dir, "node-runtime.tsv"), stringsAsFactors = FALSE, check.names = FALSE)
  entry <- pins[pins$platform == system & pins$arch == arch, , drop = FALSE]
  if (nrow(entry) != 1L) stop("Automatic Node.js setup supports Windows, macOS and Linux on x64/arm64. Install Node.js 20+ for this platform.")
  cache <- file.path(root, ".runtime", paste("node", entry$version, system, arch, sep = "-"))
  node <- file.path(cache, if (system == "win") "node.exe" else "node")
  if (compatible(node)) return(node)
  dir.create(cache, recursive = TRUE, showWarnings = FALSE)
  message("Node.js is missing or older than 20. Installing a private copy in ", cache)
  pending <- tempfile("download-", tmpdir = cache)
  on.exit(unlink(pending), add = TRUE)
  old_timeout <- getOption("timeout"); options(timeout = max(300, old_timeout))
  on.exit(options(timeout = old_timeout), add = TRUE)
  download.file(entry$url, pending, mode = "wb", quiet = TRUE, method = "libcurl")
  if (system == "win") {
    command <- file.path(Sys.getenv("SystemRoot", "C:/Windows"), "System32", "certutil.exe")
    result <- system2(command, c("-hashfile", shQuote(pending), "SHA256"), stdout = TRUE)
  } else if (nzchar(Sys.which("sha256sum"))) {
    result <- system2(Sys.which("sha256sum"), shQuote(pending), stdout = TRUE)
  } else {
    result <- system2("shasum", c("-a", "256", shQuote(pending)), stdout = TRUE)
  }
  tokens <- unlist(strsplit(tolower(result), "[[:space:]]+"))
  if (!is.null(attr(result, "status")) || !(entry$sha256 %in% tokens)) stop("Node.js download checksum mismatch; the downloaded program was not executed.")
  if (system == "win") {
    if (!file.copy(pending, node, overwrite = TRUE)) stop("Could not save the private Node.js runtime.")
  } else {
    unpack <- tempfile("unpack-", tmpdir = cache); dir.create(unpack)
    on.exit(unlink(unpack, recursive = TRUE), add = TRUE)
    if (untar(pending, files = entry$member, exdir = unpack) != 0L) stop("Could not extract Node.js.")
    if (!file.copy(file.path(unpack, entry$member), node, overwrite = TRUE)) stop("Could not save Node.js.")
    Sys.chmod(node, "0755")
  }
  if (!compatible(node)) stop("The downloaded Node.js runtime could not start on this system.")
  node
}
