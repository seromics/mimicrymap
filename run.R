# Run from Rscript, source("run.R"), or select all and run in the R console.
# Set the working directory to this package when running pasted code.
# Edit the two FASTAs in inputs/ and settings.json; missing Node.js installs locally.
local({
  if (.Platform$OS.type == "windows" && !l10n_info()[["UTF-8"]]) {
    locale <- suppressWarnings(Sys.setlocale("LC_CTYPE", ".UTF8"))
    if (!nzchar(locale) || !l10n_info()[["UTF-8"]]) stop("R 4.2+ with a UTF-8 locale is required on Windows.")
  }
  arguments <- commandArgs(trailingOnly = FALSE)
  invoked <- sub("^--file=", "", arguments[grepl("^--file=", arguments)])
  invoked <- invoked[basename(invoked) == "run.R"]
  if (length(invoked) && !file.exists(invoked)) invoked <- gsub("~+~", " ", invoked, fixed = TRUE)
  sourced <- unlist(lapply(sys.frames(), function(frame) if (!is.null(frame$ofile)) as.character(frame$ofile) else character()))
  candidates <- c(dirname(rev(sourced)), if (length(invoked)) dirname(invoked), getwd())
  roots <- candidates[file.exists(file.path(candidates, "settings.json")) & file.exists(file.path(candidates, "run.cjs"))]
  if (!length(roots)) stop("Set the working directory to the pipeline folder containing settings.json, then run this script.")
  root <- normalizePath(roots[[1]], winslash = "/", mustWork = TRUE)
  helper_dir <- file.path(root, "run")
  if (!file.exists(file.path(helper_dir, "ensure-node.R"))) helper_dir <- file.path(root, "..", "frontend", "reproduce")
  source(file.path(helper_dir, "ensure-node.R"), local = TRUE)
  node <- ensure_node(root, helper_dir)
  status <- system2(node, shQuote(file.path(root, "run.cjs")))
  if (length(invoked) && !length(sourced) && !interactive()) quit(status = status)
  if (status != 0L) stop("MimicryMap did not complete; see the message above.", call. = FALSE)
  invisible(status)
})
