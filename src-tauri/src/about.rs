use anyhow::Result;
use quick_xml::events::Event;
use quick_xml::Reader;

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Dependency {
    pub package_id: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ModAbout {
    pub package_id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub supported_versions: Vec<String>,
    pub mod_dependencies: Vec<Dependency>,
    pub load_after: Vec<String>,
    pub load_before: Vec<String>,
    pub incompatible_with: Vec<String>,
    pub published_file_id: Option<String>,
}

pub fn parse_about(xml_content: &str) -> Result<ModAbout> {
    let mut reader = Reader::from_str(xml_content);
    reader.config_mut().trim_text(true);
    reader.config_mut().check_end_names = false;

    let mut about = ModAbout::default();
    let mut buf = Vec::new();
    let mut path: Vec<String> = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                path.push(name);
            }
            Ok(Event::End(_)) => {
                path.pop();
            }
            Ok(Event::Text(e)) => {
                let txt = e.unescape().unwrap_or_default().to_string();
                if txt.trim().is_empty() { continue; }

                let mut clean_path = String::new();
                for p in &path {
                    let tag = p.split(':').last().unwrap_or(p); // strip namespace
                    if !clean_path.is_empty() { clean_path.push('/'); }
                    clean_path.push_str(tag);
                }
                
                if clean_path.ends_with("packageId") && !clean_path.contains("modDependencies") {
                    about.package_id = txt.clone();
                } else if clean_path.ends_with("name") {
                    about.name = txt;
                } else if clean_path.ends_with("author") {
                    about.author = txt;
                } else if clean_path.ends_with("description") {
                    about.description = txt;
                } else if clean_path.contains("supportedVersions") && clean_path.ends_with("li") {
                    about.supported_versions.push(txt);
                } else if clean_path.contains("modDependencies") && clean_path.contains("li") {
                    // Handling complex structured dependency
                    if clean_path.ends_with("packageId") {
                        about.mod_dependencies.push(Dependency { package_id: txt.clone(), display_name: None });
                    } else if clean_path.ends_with("displayName") {
                        if let Some(last) = about.mod_dependencies.last_mut() {
                            last.display_name = Some(txt);
                        }
                    } else if clean_path.ends_with("li") && !txt.contains('<') {
                         // Simple string dependency fallback
                         about.mod_dependencies.push(Dependency { package_id: txt.clone(), display_name: None });
                    }
                } else if clean_path.contains("loadAfter") && clean_path.ends_with("li") {
                    about.load_after.push(txt.clone());
                } else if clean_path.contains("loadBefore") && clean_path.ends_with("li") {
                    about.load_before.push(txt.clone());
                } else if clean_path.contains("incompatibleWith") && clean_path.ends_with("li") {
                    about.incompatible_with.push(txt.clone());
                } else if clean_path.ends_with("publishedFileId") {
                    about.published_file_id = Some(txt);
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => (),
        }
        buf.clear();
    }

    Ok(about)
}


